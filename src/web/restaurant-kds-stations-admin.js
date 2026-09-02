(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'ADMINISTRADOR']);
  const QUEUE_OPTIONS = [
    ['COCINA', 'Pedidos de cocina'],
    ['BARRA', 'Bebidas / barra'],
    ['POSTRES', 'Postres']
  ];
  const MODE_OPTIONS = [
    ['KDS', 'Pantalla KDS'],
    ['IMPRESORA', 'Sólo impresora'],
    ['AMBOS', 'KDS + impresora']
  ];
  const state = { rows: [], loaded: false, loading: false, observer: null, scheduled: false };

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function isAdmin() {
    return ADMIN_ROLES.has(String(session()?.user?.rol || '').toUpperCase());
  }

  function h(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function api(path, options = {}) {
    const s = session();
    if (!s?.token || !s?.subdomain) throw new Error('Sesión no disponible');
    const response = await fetch(path, {
      ...options,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${s.token}`,
        'x-tenant-subdomain': s.subdomain,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function queueLabel(value) { return QUEUE_OPTIONS.find(([key]) => key === value)?.[1] || value || '—'; }
  function modeLabel(value) { return MODE_OPTIONS.find(([key]) => key === value)?.[1] || value || '—'; }
  function optionList(options, selected, placeholder = '') {
    return `${placeholder ? `<option value="">${h(placeholder)}</option>` : ''}${options.map(([value, label]) => `<option value="${h(value)}" ${value === selected ? 'selected' : ''}>${h(label)}</option>`).join('')}`;
  }

  function activeKdsStations() {
    return state.rows.filter((row) => row.active !== false && ['KDS', 'AMBOS'].includes(String(row.mode || '').toUpperCase()));
  }

  function stationNamesForQueue(queue) {
    return activeKdsStations()
      .filter((row) => String(row.queue || '').toUpperCase() === String(queue || '').toUpperCase())
      .map((row) => String(row.name || '').trim())
      .filter(Boolean);
  }

  function ensureStyles() {
    if (document.querySelector('#restaurantKdsStationAdminStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantKdsStationAdminStyles';
    style.textContent = `
      .rkds-adminbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 12px;padding:12px 14px;border:1px solid #dbe4e0;border-radius:14px;background:#fff;box-shadow:0 5px 16px rgba(15,23,42,.04)}
      .rkds-adminbar b{display:block;font-size:13px}.rkds-adminbar span{display:block;margin-top:2px;color:#65736d;font-size:11px}
      .rkds-admin-btn{min-height:40px;padding:0 13px;border:1px solid #cdd8d3;border-radius:11px;background:#fff;font-weight:850;cursor:pointer}
      .rkds-admin-btn.primary{background:#137a53;border-color:#137a53;color:#fff}
      .rkds-config-notice{margin:0 0 12px;padding:14px 16px;border:1px dashed #f59e0b;border-radius:14px;background:#fffaf0;color:#5d4a21;font-size:12px;line-height:1.45}
      .rkds-config-notice b{display:block;margin-bottom:3px;color:#7a4b00}
      .rkds-dialog{border:0;border-radius:18px;padding:0;width:min(760px,calc(100vw - 22px));box-shadow:0 28px 80px rgba(15,23,42,.32)}
      .rkds-dialog::backdrop{background:rgba(15,23,42,.46)}
      .rkds-dialog .rkds-shell{padding:20px;display:grid;gap:14px}
      .rkds-dialog .rkds-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.rkds-dialog h2{margin:0;font-size:21px}.rkds-dialog p{margin:4px 0 0;color:#68766f;font-size:12px}
      .rkds-table-wrap{overflow:auto;border:1px solid #e1e8e4;border-radius:13px}.rkds-table{width:100%;border-collapse:collapse;min-width:650px;font-size:12px}.rkds-table th{text-align:left;color:#65736d;padding:10px;border-bottom:1px solid #e8eeeb}.rkds-table td{padding:11px 10px;border-bottom:1px solid #edf2ef;vertical-align:middle}.rkds-actions{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}
      .rkds-pill{display:inline-flex;padding:4px 8px;border-radius:999px;background:#e9f6ef;color:#176246;font-size:10px;font-weight:850}.rkds-pill.off{background:#f1f3f4;color:#717b76}
      .rkds-empty{padding:18px;border:1px dashed #cfdad5;border-radius:13px;background:#fafcfb;color:#68766f}
      .rkds-form{display:grid;gap:13px}.rkds-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.rkds-form label{display:grid;gap:6px;font-size:12px;font-weight:850}.rkds-form input,.rkds-form select{min-height:42px;border:1px solid #cfd8d4;border-radius:10px;padding:0 10px;background:#fff}.rkds-form-actions{display:flex;justify-content:flex-end;gap:8px}.rkds-error{color:#a12d2d;font-size:12px;font-weight:750}
      @media(max-width:700px){.rkds-adminbar,.rkds-dialog .rkds-head{display:grid}.rkds-grid{grid-template-columns:1fr}.rkds-admin-btn{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function kdsActive() {
    return location.pathname.startsWith('/app/centro-de-control') && (
      new URLSearchParams(location.search).get('view') === 'kds' ||
      Boolean(document.querySelector('[data-tab="kds"].active'))
    );
  }

  async function loadRows() {
    if (!isAdmin() || state.loading) return state.rows;
    state.loading = true;
    try {
      const rows = await api('/api/v1/impresion/estaciones');
      state.rows = Array.isArray(rows) ? rows : [];
      state.loaded = true;
      return state.rows;
    } finally { state.loading = false; }
  }

  function applyConfiguredLanes(view) {
    if (!view) return;
    const activeStations = activeKdsStations();

    view.querySelectorAll('.kds-v2-lane[data-station]').forEach((lane) => {
      const queue = String(lane.dataset.station || '').toUpperCase();
      const names = stationNamesForQueue(queue);
      if (!names.length) {
        lane.style.setProperty('display', 'none', 'important');
        lane.dataset.rkdsHidden = 'true';
        return;
      }
      lane.style.removeProperty('display');
      delete lane.dataset.rkdsHidden;
      const heading = lane.querySelector('header h2');
      if (heading) heading.textContent = names.join(' / ');
      const emptyText = lane.querySelector('.kds-empty span');
      if (emptyText) emptyText.textContent = `Los nuevos pedidos asignados a ${names.join(' / ')} aparecerán aquí automáticamente.`;
    });

    const shell = view.querySelector('.kds-v2');
    const existing = view.querySelector('[data-rkds-config-notice]');
    if (!activeStations.length && shell) {
      if (!existing) {
        const notice = document.createElement('div');
        notice.className = 'rkds-config-notice';
        notice.dataset.rkdsConfigNotice = 'true';
        notice.innerHTML = '<b>No hay KDS creados para este restaurante.</b>Los carriles Cocina, Barra y Postres no se crean por defecto. Usa “Gestionar KDS / estaciones” para crear únicamente los que realmente existan.';
        const lanes = shell.querySelector('.kds-v2-lanes');
        if (lanes) lanes.before(notice); else shell.appendChild(notice);
      }
    } else {
      existing?.remove();
    }
  }

  function scheduleEnhance() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      state.scheduled = false;
      enhance().catch(() => {});
    });
  }

  async function enhance() {
    if (!isAdmin() || !kdsActive()) return;
    ensureStyles();
    if (!state.loaded) await loadRows().catch(() => {});
    const view = document.querySelector('#view');
    if (!view) return;

    applyConfiguredLanes(view);

    if (!view.querySelector('[data-rkds-adminbar]')) {
      const bar = document.createElement('div');
      bar.className = 'rkds-adminbar';
      bar.dataset.rkdsAdminbar = 'true';
      bar.innerHTML = `<div><b>Administrar KDS</b><span>${activeKdsStations().length} KDS activo(s). Crea, edita o retira las áreas de preparación desde esta misma pantalla.</span></div><button type="button" class="rkds-admin-btn primary" data-rkds-manage>Gestionar KDS / estaciones</button>`;
      view.prepend(bar);
      bar.querySelector('[data-rkds-manage]')?.addEventListener('click', openManager);
    }

    const empty = view.querySelector('[data-no-kds-configured]');
    if (empty && !empty.querySelector('[data-rkds-create-first]')) {
      empty.insertAdjacentHTML('beforeend', '<br><br><button type="button" class="rkds-admin-btn primary" data-rkds-create-first>+ Crear primera estación</button>');
      empty.querySelector('[data-rkds-create-first]')?.addEventListener('click', () => stationDialog());
    }
  }

  function managerRows() {
    if (!state.rows.length) return '<div class="rkds-empty"><b>No hay estaciones creadas.</b><br>El restaurante comienza con cero KDS/cocinas. Crea la primera sólo cuando la necesites.</div>';
    return `<div class="rkds-table-wrap"><table class="rkds-table"><thead><tr><th>Nombre</th><th>Recibe</th><th>Trabaja con</th><th>Estado</th><th></th></tr></thead><tbody>${state.rows.map((row) => `<tr><td><b>${h(row.name)}</b></td><td>${h(queueLabel(row.queue))}</td><td>${h(modeLabel(row.mode))}</td><td><span class="rkds-pill ${row.active ? '' : 'off'}">${row.active ? 'Activa' : 'Inactiva'}</span></td><td><div class="rkds-actions"><button type="button" class="rkds-admin-btn" data-rkds-edit="${h(row.id)}">Editar</button>${row.active ? `<button type="button" class="rkds-admin-btn" data-rkds-off="${h(row.id)}">Retirar</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
  }

  async function openManager() {
    await loadRows().catch(() => {});
    document.querySelector('#restaurantKdsStationManager')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'restaurantKdsStationManager';
    dialog.className = 'rkds-dialog';
    dialog.innerHTML = `<div class="rkds-shell"><div class="rkds-head"><div><h2>Gestionar KDS / estaciones</h2><p>Configuración propia del restaurante. No se crea ninguna estación por defecto.</p></div><button type="button" class="rkds-admin-btn" data-rkds-close>Cerrar</button></div><div class="rkds-actions"><button type="button" class="rkds-admin-btn primary" data-rkds-new>+ Nueva estación</button></div><div data-rkds-list>${managerRows()}</div></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('[data-rkds-close]')?.addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-rkds-new]')?.addEventListener('click', () => stationDialog());
    dialog.querySelectorAll('[data-rkds-edit]').forEach((button) => button.addEventListener('click', () => stationDialog(button.dataset.rkdsEdit)));
    dialog.querySelectorAll('[data-rkds-off]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('¿Retirar esta estación? Dejará de recibir nuevas comandas.')) return;
      try {
        await api(`/api/v1/impresion/estaciones/${button.dataset.rkdsOff}`, { method:'DELETE' });
        await afterMutation();
        dialog.close();
        openManager();
      } catch (error) { alert(error.message); }
    }));
    dialog.addEventListener('close', () => dialog.remove(), { once:true });
    dialog.showModal();
  }

  function stationDialog(id = '') {
    const current = id ? state.rows.find((row) => row.id === id) : null;
    document.querySelector('#restaurantKdsStationEditor')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'restaurantKdsStationEditor';
    dialog.className = 'rkds-dialog';
    dialog.innerHTML = `<form class="rkds-shell rkds-form" data-rkds-form><div class="rkds-head"><div><h2>${current ? 'Editar estación' : 'Nueva estación'}</h2><p>Define qué pedidos recibe y si usa pantalla KDS, impresora o ambas.</p></div></div><label>Nombre<input id="rkdsName" maxlength="80" value="${h(current?.name || '')}" placeholder="Ej. Cocina caliente, Barra terraza" required></label><div class="rkds-grid"><label>Qué pedidos recibe<select id="rkdsQueue" required>${optionList(QUEUE_OPTIONS, current?.queue || '', 'Selecciona…')}</select></label><label>Cómo trabaja<select id="rkdsMode" required>${optionList(MODE_OPTIONS, current?.mode || '', 'Selecciona…')}</select></label></div><div class="rkds-error" data-rkds-error></div><div class="rkds-form-actions"><button type="button" class="rkds-admin-btn" data-rkds-cancel>Cancelar</button><button type="submit" class="rkds-admin-btn primary">Guardar estación</button></div></form>`;
    document.body.appendChild(dialog);
    dialog.querySelector('[data-rkds-cancel]')?.addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-rkds-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = dialog.querySelector('[data-rkds-error]');
      if (errorBox) errorBox.textContent = '';
      const payload = {
        name: dialog.querySelector('#rkdsName').value.trim(),
        queue: dialog.querySelector('#rkdsQueue').value,
        mode: dialog.querySelector('#rkdsMode').value,
        active: current ? current.active !== false : true
      };
      try {
        await api(current ? `/api/v1/impresion/estaciones/${current.id}` : '/api/v1/impresion/estaciones', {
          method: current ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        });
        dialog.close();
        await afterMutation();
      } catch (error) { if (errorBox) errorBox.textContent = error.message; }
    });
    dialog.addEventListener('close', () => dialog.remove(), { once:true });
    dialog.showModal();
  }

  async function afterMutation() {
    state.loaded = false;
    await loadRows();
    await window.RestaurantTheme?.refreshProductionStations?.();
    const kds = document.querySelector('[data-tab="kds"]');
    if (kds) kds.click();
    scheduleEnhance();
  }

  function start() {
    if (!location.pathname.startsWith('/app/centro-de-control') || !isAdmin()) return;
    ensureStyles();
    loadRows().then(scheduleEnhance).catch(() => {});
    if (!state.observer && document.body) {
      state.observer = new MutationObserver(scheduleEnhance);
      state.observer.observe(document.body, { childList:true, subtree:true });
    }
    window.addEventListener('popstate', scheduleEnhance);
  }

  window.RestaurantKdsStationsAdmin = { refresh: afterMutation, openManager };
  start();
})();
