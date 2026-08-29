(() => {
  'use strict';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain || !['ADMIN','SUPER_ADMIN'].includes(String(session.user?.rol || ''))) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const fmt = (value) => value ? new Date(value).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' }) : '—';

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
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureDialog() {
    let dialog = document.querySelector('#waiterDeviceDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'waiterDeviceDialog';
    dialog.className = 'ri-card';
    dialog.style.cssText = 'width:min(820px,calc(100vw - 20px));max-height:90dvh;overflow:auto;border:0;border-radius:20px;padding:0;';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close?.(); });
    return dialog;
  }

  function statusPill(row) {
    const active = row.active;
    const label = row.status === 'PAIRING' ? 'Pendiente QR' : active ? 'Conectado' : 'Revocado';
    const bg = row.status === 'PAIRING' ? '#fff7ed' : active ? '#f0fdf4' : '#f1f5f9';
    const color = row.status === 'PAIRING' ? '#9a3412' : active ? '#166534' : '#64748b';
    return `<span style="padding:5px 8px;border-radius:999px;background:${bg};color:${color};font-size:10px;font-weight:900">${label}</span>`;
  }

  async function openManager() {
    const dialog = ensureDialog();
    dialog.innerHTML = '<div style="padding:22px"><div class="ri-muted">Cargando dispositivos…</div></div>';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open','');
    try {
      const [users, devices] = await Promise.all([api('/api/v1/usuarios'), api('/api/v1/restaurante/dispositivos-mesero')]);
      const waiters = (Array.isArray(users) ? users : []).filter((user) => user.activo && user.rol === 'MESERO');
      dialog.innerHTML = `<div style="padding:20px 22px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div class="ri-eyebrow">Dispositivos de Mesero</div><h2 style="margin:3px 0">Conectar tablet o celular</h2><p class="ri-muted" style="margin:4px 0 0">Elige el mesero, genera un QR temporal y escanéalo desde el dispositivo.</p></div><button type="button" class="ri-btn" data-wd-close>Cerrar</button></div>
        <div style="padding:20px 22px;display:grid;gap:18px">
          <section class="ri-card" style="padding:16px!important;box-shadow:none!important"><div style="display:grid;grid-template-columns:minmax(220px,1fr) minmax(180px,.8fr) auto;gap:10px;align-items:end">
            <label class="ri-label">Mesero<select id="wdWaiter" class="ri-select"><option value="">Selecciona…</option>${waiters.map((user) => `<option value="${user.id}">${esc(user.nombre)} · ${esc(user.email)}</option>`).join('')}</select></label>
            <label class="ri-label">Nombre del dispositivo<input id="wdDeviceName" class="ri-input" maxlength="80" value="Tablet Mesero"></label>
            <button type="button" class="ri-btn primary" id="wdGenerate" ${waiters.length ? '' : 'disabled'}>Generar QR</button>
          </div>${waiters.length ? '' : '<div class="ri-error" style="margin-top:12px">No hay usuarios activos con rol MESERO. Créalo primero en Usuarios.</div>'}<div id="wdPairResult"></div></section>
          <section><div class="ri-toolbar"><div><div class="ri-eyebrow">Equipos vinculados</div><h3 style="margin:2px 0">Tablets y celulares</h3></div><span class="push ri-muted">${devices.length} registro(s)</span></div><div style="display:grid;gap:8px">${devices.map((row) => `<article style="display:grid;grid-template-columns:minmax(180px,1fr) minmax(160px,.8fr) auto auto;gap:10px;align-items:center;padding:11px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc"><div><b style="display:block">${esc(row.deviceName)}</b><small class="ri-muted">${esc(row.waiter?.nombre || 'Mesero no disponible')}</small></div><div><small class="ri-muted">Último uso</small><b style="display:block;font-size:12px">${esc(fmt(row.lastSeenAt))}</b></div>${statusPill(row)}${row.active || row.status === 'PAIRING' ? `<button type="button" class="ri-btn small danger" data-wd-revoke="${row.id}">Desautorizar</button>` : '<span></span>'}</article>`).join('') || '<div class="empty-ticket">Aún no hay dispositivos vinculados.</div>'}</div></section>
        </div>`;
      dialog.querySelector('[data-wd-close]')?.addEventListener('click', () => dialog.close?.());
      dialog.querySelector('#wdGenerate')?.addEventListener('click', async () => {
        const userId = dialog.querySelector('#wdWaiter')?.value;
        const deviceName = dialog.querySelector('#wdDeviceName')?.value || 'Tablet Mesero';
        const result = dialog.querySelector('#wdPairResult');
        if (!userId) { result.innerHTML = '<div class="ri-error" style="margin-top:12px">Selecciona el mesero que usará este equipo.</div>'; return; }
        const button = dialog.querySelector('#wdGenerate');
        button.disabled = true; button.textContent = 'Generando…';
        try {
          const data = await api('/api/v1/restaurante/dispositivos-mesero/vinculo', { method:'POST', body:JSON.stringify({ userId, deviceName }) });
          result.innerHTML = `<div style="margin-top:14px;padding:14px;border:1px solid #bfdbfe;border-radius:14px;background:#eff6ff"><div style="display:grid;grid-template-columns:minmax(210px,300px) 1fr;gap:16px;align-items:center"><div style="background:#fff;border-radius:12px;padding:8px">${data.svg}</div><div><b style="font-size:18px">Escanea este QR</b><p style="margin:6px 0;color:#334155">Abre la cámara del tablet o celular. El vínculo vence a las ${new Date(data.expiresAt).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})} y sólo puede utilizarse una vez.</p><a class="ri-btn" href="${esc(data.url)}" target="_blank" rel="noopener">Abrir enlace de instalación</a></div></div></div>`;
        } catch (error) { result.innerHTML = `<div class="ri-error" style="margin-top:12px">${esc(error.message)}</div>`; }
        finally { button.disabled = false; button.textContent = 'Generar QR'; }
      });
      dialog.querySelectorAll('[data-wd-revoke]').forEach((button) => button.addEventListener('click', async () => {
        if (!confirm('¿Desautorizar este dispositivo? Dejará de poder operar como Mesero.')) return;
        button.disabled = true;
        try { await api(`/api/v1/restaurante/dispositivos-mesero/${button.dataset.wdRevoke}`, { method:'DELETE' }); await openManager(); }
        catch (error) { alert(error.message); button.disabled = false; }
      }));
    } catch (error) {
      dialog.innerHTML = `<div style="padding:22px"><div class="ri-error">${esc(error.message)}</div><button type="button" class="ri-btn" onclick="this.closest('dialog').close()">Cerrar</button></div>`;
    }
  }

  function enhance() {
    const titleRow = document.querySelector('#view .waiter-title-row');
    if (!titleRow || titleRow.querySelector('[data-connect-waiter-device]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ri-btn secondary';
    button.dataset.connectWaiterDevice = 'true';
    button.textContent = '▣ Conectar tablet o celular';
    button.style.minHeight = '48px';
    button.addEventListener('click', openManager);
    const badge = titleRow.querySelector('.waiter-user-badge');
    if (badge) titleRow.insertBefore(button, badge); else titleRow.appendChild(button);
  }

  const observer = new MutationObserver(enhance);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  enhance();
})();
