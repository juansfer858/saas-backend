(() => {
  'use strict';
  const MARKER = 'VANTIX_RESTAURANT_PRODUCTION_DEVICE_ADMIN_V63';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const PRODUCTION_ROLES = ['COCINA','BARRA','POSTRES'];
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;
  const isAdmin = ['ADMIN','SUPER_ADMIN'].includes(String(session.user?.rol || '').toUpperCase());
  if (!isAdmin) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const fmt = (value) => value ? new Date(value).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' }) : '—';
  const roleLabel = (role) => role === 'COCINA' ? 'Cocina' : role === 'BARRA' ? 'Barra' : role === 'POSTRES' ? 'Postres' : role;
  let usersCache = null;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:{
        Authorization:`Bearer ${session.token}`,
        'x-tenant-subdomain':session.subdomain,
        ...(options.body ? { 'Content-Type':'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  async function users(force = false) {
    if (usersCache && !force) return usersCache;
    const rows = await api('/api/v1/usuarios');
    usersCache = Array.isArray(rows) ? rows : [];
    return usersCache;
  }

  function ensureDialog() {
    let dialog = document.querySelector('#productionDeviceDialogV63');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'productionDeviceDialogV63';
    dialog.className = 'ri-card';
    dialog.style.cssText = 'width:min(850px,calc(100vw - 20px));max-height:92dvh;overflow:auto;border:0;border-radius:20px;padding:0;';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close?.(); });
    return dialog;
  }

  function statusPill(row) {
    const active = row.active;
    const label = row.status === 'PAIRING' ? 'Pendiente QR' : active ? 'Conectada' : 'Revocada';
    const bg = row.status === 'PAIRING' ? '#fff7ed' : active ? '#f0fdf4' : '#f1f5f9';
    const color = row.status === 'PAIRING' ? '#9a3412' : active ? '#166534' : '#64748b';
    return `<span style="padding:5px 8px;border-radius:999px;background:${bg};color:${color};font-size:10px;font-weight:900">${label}</span>`;
  }

  async function openManager(preselectedUserId = null) {
    const dialog = ensureDialog();
    dialog.innerHTML = '<div style="padding:22px"><div class="ri-muted">Cargando tablets de producción…</div></div>';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open','');
    try {
      const [allUsers, devices] = await Promise.all([users(true), api('/api/v1/restaurante/dispositivos-produccion')]);
      const production = allUsers.filter((user) => user.activo && PRODUCTION_ROLES.includes(user.rol));
      dialog.innerHTML = `<div style="padding:20px 22px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div class="ri-eyebrow">TABLETS DE PRODUCCIÓN · V63</div><h2 style="margin:3px 0">Conectar tablet de Cocina / Barra / Postres</h2><p class="ri-muted" style="margin:4px 0 0">Se vincula una sola vez. La tablet abre únicamente su estación y permanece autorizada hasta que la desautorices.</p></div><button type="button" class="ri-btn" data-pd-close>Cerrar</button></div>
        <div style="padding:20px 22px;display:grid;gap:18px">
          <section class="ri-card" style="padding:16px!important;box-shadow:none!important"><div style="display:grid;grid-template-columns:minmax(220px,1fr) minmax(180px,.8fr) auto;gap:10px;align-items:end">
            <label class="ri-label">Empleado / estación<select id="pdUser" class="ri-select"><option value="">Selecciona…</option>${production.map((user) => `<option value="${user.id}">${esc(user.nombre)} · ${esc(roleLabel(user.rol))}</option>`).join('')}</select></label>
            <label class="ri-label">Nombre de la tablet<input id="pdDeviceName" class="ri-input" maxlength="80" value="Tablet Producción"></label>
            <button type="button" class="ri-btn primary" id="pdGenerate" ${production.length ? '' : 'disabled'}>Generar QR</button>
          </div>${production.length ? '' : '<div class="ri-error" style="margin-top:12px">No hay empleados activos con rol Cocina, Barra o Postres.</div>'}<div id="pdPairResult"></div></section>
          <section><div class="ri-toolbar"><div><div class="ri-eyebrow">EQUIPOS VINCULADOS</div><h3 style="margin:2px 0">Tablets de producción</h3></div><span class="push ri-muted">${devices.length} registro(s)</span></div><div style="display:grid;gap:8px">${devices.map((row) => `<article style="display:grid;grid-template-columns:minmax(180px,1fr) minmax(130px,.6fr) minmax(140px,.7fr) auto auto;gap:10px;align-items:center;padding:11px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc"><div><b style="display:block">${esc(row.deviceName)}</b><small class="ri-muted">${esc(row.user?.nombre || 'Empleado no disponible')}</small></div><b>${esc(roleLabel(row.station || row.user?.rol || ''))}</b><div><small class="ri-muted">Último uso</small><b style="display:block;font-size:12px">${esc(fmt(row.lastSeenAt))}</b></div>${statusPill(row)}${row.active || row.status === 'PAIRING' ? `<button type="button" class="ri-btn small danger" data-pd-revoke="${row.id}">Desautorizar</button>` : '<span></span>'}</article>`).join('') || '<div class="empty-ticket">Aún no hay tablets de producción vinculadas.</div>'}</div></section>
        </div>`;
      const selected = String(preselectedUserId || '');
      if (selected && production.some((user) => user.id === selected)) {
        dialog.querySelector('#pdUser').value = selected;
        const user = production.find((row) => row.id === selected);
        dialog.querySelector('#pdDeviceName').value = `Tablet ${roleLabel(user?.rol)}`;
      }
      dialog.querySelector('[data-pd-close]')?.addEventListener('click', () => dialog.close?.());
      dialog.querySelector('#pdUser')?.addEventListener('change', (event) => {
        const user = production.find((row) => row.id === event.target.value);
        if (user) dialog.querySelector('#pdDeviceName').value = `Tablet ${roleLabel(user.rol)}`;
      });
      dialog.querySelector('#pdGenerate')?.addEventListener('click', async () => {
        const userId = dialog.querySelector('#pdUser')?.value;
        const deviceName = dialog.querySelector('#pdDeviceName')?.value || 'Tablet Producción';
        const result = dialog.querySelector('#pdPairResult');
        if (!userId) { result.innerHTML = '<div class="ri-error" style="margin-top:12px">Selecciona Cocina, Barra o Postres.</div>'; return; }
        const button = dialog.querySelector('#pdGenerate');
        button.disabled = true; button.textContent = 'Generando…';
        try {
          const data = await api('/api/v1/restaurante/dispositivos-produccion/vinculo', { method:'POST', body:JSON.stringify({ userId, deviceName }) });
          result.innerHTML = `<div style="margin-top:14px;padding:14px;border:1px solid #bbf7d0;border-radius:14px;background:#f0fdf4"><div style="display:grid;grid-template-columns:minmax(210px,300px) 1fr;gap:16px;align-items:center"><div style="background:#fff;border-radius:12px;padding:8px">${data.svg}</div><div><div class="ri-eyebrow">${esc(roleLabel(data.station))}</div><b style="font-size:18px">Escanea este QR desde la tablet</b><p style="margin:6px 0;color:#334155">El vínculo vence a las ${new Date(data.expiresAt).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})} y sólo puede usarse una vez. Después, la tablet queda vinculada hasta que la desautorices.</p><a class="ri-btn" href="${esc(data.url)}" target="_blank" rel="noopener">Abrir enlace de vinculación</a></div></div></div>`;
        } catch (error) { result.innerHTML = `<div class="ri-error" style="margin-top:12px">${esc(error.message)}</div>`; }
        finally { button.disabled = false; button.textContent = 'Generar QR'; }
      });
      dialog.querySelectorAll('[data-pd-revoke]').forEach((button) => button.addEventListener('click', async () => {
        if (!confirm('¿Desautorizar esta tablet? Dejará de recibir y operar comandas de producción.')) return;
        button.disabled = true;
        try { await api(`/api/v1/restaurante/dispositivos-produccion/${button.dataset.pdRevoke}`, { method:'DELETE' }); await openManager(); }
        catch (error) { alert(error.message); button.disabled = false; }
      }));
    } catch (error) {
      dialog.innerHTML = `<div style="padding:22px"><div class="ri-error">${esc(error.message)}</div><button type="button" class="ri-btn" onclick="this.closest('dialog').close()">Cerrar</button></div>`;
    }
  }

  async function enhanceEmployeeCards() {
    const cards = [...document.querySelectorAll('[data-employee-card]')];
    if (!cards.length) return;
    let allUsers;
    try { allUsers = await users(); } catch { return; }
    const byId = new Map(allUsers.map((user) => [user.id, user]));
    for (const card of cards) {
      if (card.querySelector('[data-production-connect]')) continue;
      const user = byId.get(card.dataset.employeeCard);
      if (!user?.activo || !PRODUCTION_ROLES.includes(user.rol)) continue;
      const actions = card.querySelector('.employee-actions');
      if (!actions) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ri-btn small secondary';
      button.dataset.productionConnect = user.id;
      button.textContent = `▣ Conectar tablet ${roleLabel(user.rol)}`;
      button.addEventListener('click', () => openManager(user.id));
      actions.appendChild(button);
    }
  }

  let timer = 0;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => enhanceEmployeeCards().catch(() => {}), 40);
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  enhanceEmployeeCards().catch(() => {});

  window.VantixGCProductionDeviceAdminV63 = Object.freeze({ marker:MARKER, version:'63.0.0', open:(userId=null)=>openManager(userId), roles:[...PRODUCTION_ROLES] });
})();
