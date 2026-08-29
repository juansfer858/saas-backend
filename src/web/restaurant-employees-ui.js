(() => {
  'use strict';

  const MARKER = 'VANTIX_EMPLOYEE_ASSIGNMENT_EDITOR_V1';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;

  const isAdmin = ['ADMIN','SUPER_ADMIN'].includes(String(session.user?.rol || '').toUpperCase());
  const $ = (query, root = document) => root.querySelector(query);
  const $$ = (query, root = document) => [...root.querySelectorAll(query)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const ROLE_INFO = Object.freeze({
    MESERO:['Mesero','Mesas, pedidos y domicilios'],
    COCINA:['Cocina','Comandas y producción'],
    BARRA:['Barra','Comandas y producción'],
    POSTRES:['Postres','Comandas y producción'],
    CAJERO:['Cajero','Caja, cobros y recaudos'],
    ADMIN:['Administrador','Administración completa del restaurante'],
    CONTADOR:['Contador','Contabilidad y reportes financieros'],
    SUPER_ADMIN:['Super administrador','Cuenta protegida de plataforma']
  });
  const CREATE_ROLES = ['MESERO','COCINA','BARRA','POSTRES','CAJERO','ADMIN','CONTADOR'];
  const PRODUCTION_ROLES = ['COCINA','BARRA','POSTRES'];
  let query = '';
  let roleFilter = 'TODOS';
  let assignmentOptions = null;
  let profileByUser = new Map();

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
    if (response.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      location.replace('/app');
      throw new Error('Sesión vencida');
    }
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function injectStyles() {
    if ($('#restaurantEmployeesStyle')) return;
    const style = document.createElement('style');
    style.id = 'restaurantEmployeesStyle';
    style.textContent = `
      .employees-shell{display:grid;gap:14px}.employees-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.employees-head h1{margin:2px 0;font-size:30px}.employees-head p{margin:5px 0 0;color:var(--cc-muted)}
      .employees-summary{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:9px}.employees-summary .ri-card{padding:14px!important;box-shadow:none!important}.employees-summary small{display:block;color:var(--cc-muted);font-size:10px;font-weight:900;text-transform:uppercase}.employees-summary strong{display:block;margin-top:5px;font-size:24px}
      .employees-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.employees-search{min-height:46px;flex:1 1 260px}.employees-filter{min-height:46px;min-width:180px}.employees-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}.employee-card{padding:15px!important;display:grid;gap:10px;box-shadow:none!important}.employee-card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.employee-card h3{margin:0;font-size:17px}.employee-card small{color:var(--cc-muted)}.employee-role{font-weight:900}.employee-role-desc{font-size:11px;color:var(--cc-muted)}.employee-actions{display:flex;gap:8px;flex-wrap:wrap}.employee-actions .ri-btn{min-height:44px}.employee-status{font-size:10px;font-weight:900}.employee-self{font-size:10px;font-weight:900;color:var(--cc-muted)}
      .employee-assignment{padding:9px 10px;border:1px solid var(--cc-line);border-radius:10px;background:rgba(248,250,252,.74);display:grid;gap:4px}.employee-assignment b{font-size:11px}.employee-assignment span{font-size:10px;color:var(--cc-muted);line-height:1.35}.employee-flex{color:#137a53!important;font-weight:850!important}
      .employee-dialog{width:min(900px,calc(100vw - 22px));max-height:94dvh;padding:0;border:0;border-radius:18px;overflow:auto}.employee-dialog::backdrop{background:rgb(15 23 42 / .5)}.employee-dialog-head{position:sticky;top:0;z-index:2;padding:17px 19px;border-bottom:1px solid var(--cc-line);background:var(--paper,#fff);display:flex;justify-content:space-between;gap:12px}.employee-dialog-body{padding:18px 19px;display:grid;gap:13px}.employee-fields{display:grid;grid-template-columns:1fr 1fr;gap:11px}.employee-field{display:grid;gap:6px;font-weight:800;font-size:12px}.employee-field.full{grid-column:1/-1}.employee-field input,.employee-field select{width:100%;min-height:49px}.employee-form-actions{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap}
      .employee-scope{grid-column:1/-1;border:1px solid var(--cc-line);border-radius:14px;padding:13px;display:grid;gap:12px;background:rgba(248,250,252,.72)}.employee-scope-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.employee-scope-head h3{margin:0;font-size:15px}.employee-scope-head p{margin:4px 0 0;color:var(--cc-muted);font-size:11px;line-height:1.4}.employee-flex-pill{padding:5px 8px;border-radius:999px;background:#ecfdf5;color:#166534;font-size:9px;font-weight:900;white-space:nowrap}
      .employee-scope-block{display:grid;gap:7px}.employee-scope-block>strong{font-size:11px}.employee-check-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:7px}.employee-check{display:flex;align-items:flex-start;gap:8px;min-height:42px;padding:8px 9px;border:1px solid #d7dee4;border-radius:9px;background:#fff;cursor:pointer}.employee-check input{width:18px!important;height:18px!important;min-height:18px!important;margin:1px 0 0}.employee-check b{display:block;font-size:11px}.employee-check small{display:block;margin-top:2px;font-size:9px;color:var(--cc-muted)}.employee-scope-note{padding:9px 10px;border-radius:9px;background:#eff6ff;color:#334155;font-size:10px;line-height:1.45}
      @media(max-width:760px){.employees-head{display:grid}.employees-summary{grid-template-columns:1fr 1fr}.employees-grid{grid-template-columns:1fr}.employee-fields{grid-template-columns:1fr}.employee-field.full,.employee-scope{grid-column:auto}.employees-filter{flex:1 1 180px}.employee-form-actions .ri-btn{width:100%;min-height:50px}.employee-check-grid{grid-template-columns:1fr}.employee-scope-head{display:grid}}
      @media(pointer:coarse){.employee-actions .ri-btn,.employees-toolbar .ri-btn{min-height:48px}.employee-check{min-height:48px}}
    `;
    document.head.appendChild(style);
  }

  function roleLabel(role) { return ROLE_INFO[role]?.[0] || role || 'Sin rol'; }
  function roleDescription(role) { return ROLE_INFO[role]?.[1] || 'Rol de otro módulo del Core'; }
  function stationLabel(station) { return station === 'COCINA' ? 'Cocina' : station === 'BARRA' ? 'Barra' : station === 'POSTRES' ? 'Postres' : station; }
  function roleOptions(selected) { return CREATE_ROLES.map((role) => `<option value="${role}" ${role === selected ? 'selected' : ''}>${esc(roleLabel(role))}</option>`).join(''); }
  function operationalRole(role) { return role === 'MESERO' || PRODUCTION_ROLES.includes(role); }

  async function loadAssignmentOptions(force = false) {
    if (assignmentOptions && !force) return assignmentOptions;
    assignmentOptions = await api('/api/v1/restaurante/empleados/asignaciones/opciones');
    return assignmentOptions;
  }

  async function loadProfiles() {
    const profiles = await api('/api/v1/restaurante/empleados/asignaciones');
    profileByUser = new Map((Array.isArray(profiles) ? profiles : []).map((profile) => [profile.userId, profile]));
    return profiles;
  }

  function assignmentSummary(row) {
    const profile = profileByUser.get(row.id);
    if (row.rol === 'MESERO') {
      const parts = [];
      if (profile?.zones?.length) parts.push(`Zonas: ${profile.zones.map((zone) => zone.name).join(', ')}`);
      if (profile?.tables?.length) parts.push(`Mesas: ${profile.tables.map((table) => table.name).join(', ')}`);
      return {
        title:parts.length ? 'Prioridad de atención' : 'Sin prioridad fija',
        text:parts.length ? parts.join(' · ') : 'Ve todas las zonas y mesas.',
        flexible:'Puede reforzar cualquier zona o mesa.'
      };
    }
    if (PRODUCTION_ROLES.includes(row.rol)) {
      const stations = profile?.stations?.length ? profile.stations : [row.rol];
      return {
        title:'Módulos principales',
        text:stations.map(stationLabel).join(' + '),
        flexible:'Puede abrir “Ver todas las estaciones” para refuerzo.'
      };
    }
    return null;
  }

  function ensureDialog() {
    let dialog = $('#restaurantEmployeeDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'restaurantEmployeeDialog';
    dialog.className = 'employee-dialog';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close?.(); });
    return dialog;
  }

  function userCard(row) {
    const self = row.id === session.user?.id;
    const manageableRole = CREATE_ROLES.includes(row.rol);
    const scope = assignmentSummary(row);
    return `<article class="ri-card employee-card" data-employee-card="${esc(row.id)}">
      <div class="employee-card-head"><div><h3>${esc(row.nombre)}</h3><small>${esc(row.email)}</small></div><div style="text-align:right"><span class="employee-status">${row.activo ? '● ACTIVO' : '○ INACTIVO'}</span>${self ? '<div class="employee-self">TU CUENTA</div>' : ''}</div></div>
      <div><div class="employee-role">${esc(roleLabel(row.rol))}</div><div class="employee-role-desc">${esc(roleDescription(row.rol))}</div></div>
      ${scope ? `<div class="employee-assignment"><b>${esc(scope.title)}</b><span>${esc(scope.text)}</span><span class="employee-flex">${esc(scope.flexible)}</span></div>` : ''}
      <div class="employee-actions">${!manageableRole ? '<span class="ri-muted">Rol administrado fuera de Restaurante</span>' : `<button type="button" class="ri-btn small" data-employee-edit="${esc(row.id)}">Editar y asignar</button>${row.rol === 'MESERO' && row.activo ? `<button type="button" class="ri-btn small secondary" data-employee-connect="${esc(row.id)}">▣ Conectar tablet/celular</button>` : ''}${!self ? `<button type="button" class="ri-btn small ${row.activo ? 'danger' : 'secondary'}" data-employee-toggle="${esc(row.id)}" data-active="${row.activo ? '1' : '0'}">${row.activo ? 'Desactivar' : 'Activar'}</button>` : ''}`}</div>
    </article>`;
  }

  function bindCards(root, users) {
    const byId = new Map(users.map((user) => [user.id, user]));
    $$('[data-employee-edit]', root).forEach((button) => button.addEventListener('click', () => openEmployeeDialog(byId.get(button.dataset.employeeEdit))));
    $$('[data-employee-connect]', root).forEach((button) => button.addEventListener('click', () => window.VantixGCWaiterDeviceAdmin?.open?.(button.dataset.employeeConnect)));
    $$('[data-employee-toggle]', root).forEach((button) => button.addEventListener('click', async () => {
      const row = byId.get(button.dataset.employeeToggle);
      if (!row) return;
      const next = button.dataset.active !== '1';
      const action = next ? 'activar' : 'desactivar';
      if (!confirm(`¿${action.charAt(0).toUpperCase() + action.slice(1)} a ${row.nombre}?`)) return;
      button.disabled = true;
      try { await api(`/api/v1/usuarios/${row.id}`, { method:'PATCH', body:JSON.stringify({ activo:next }) }); await renderEmployees(false); }
      catch (error) { alert(error.message); button.disabled = false; }
    }));
  }

  function applyFilters(users) {
    const q = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchRole = roleFilter === 'TODOS' || user.rol === roleFilter;
      const scope = assignmentSummary(user);
      const haystack = `${user.nombre} ${user.email} ${roleLabel(user.rol)} ${scope?.text || ''}`.toLowerCase();
      return matchRole && (!q || haystack.includes(q));
    });
  }

  async function renderEmployees(pushState = true) {
    injectStyles();
    const root = window.VantixGCRestaurantControlCenter?.openCustomView?.('empleados', pushState);
    if (!root) return;
    if (!isAdmin) { root.innerHTML = '<div class="ri-error">Sólo Administrador puede gestionar empleados.</div>'; return; }
    root.innerHTML = '<div class="ri-muted">Cargando empleados y asignaciones…</div>';
    try {
      const [response] = await Promise.all([api('/api/v1/usuarios'), loadProfiles()]);
      const users = Array.isArray(response) ? response : [];
      const active = users.filter((user) => user.activo);
      const serviceStaff = active.filter((user) => user.rol === 'MESERO').length;
      const productionStaff = active.filter((user) => PRODUCTION_ROLES.includes(user.rol)).length;
      const cashStaff = active.filter((user) => user.rol === 'CAJERO').length;
      const visible = applyFilters(users);
      root.innerHTML = `<section class="employees-shell">
        <header class="employees-head"><div><div class="ri-eyebrow">PERSONAL DEL RESTAURANTE</div><h1>Empleados</h1><p>Define función y zona/módulos principales. Las asignaciones organizan el trabajo, pero nunca bloquean un refuerzo.</p></div><button type="button" class="ri-btn primary" data-new-employee>+ NUEVO EMPLEADO</button></header>
        <div class="employees-summary"><div class="ri-card"><small>Activos</small><strong>${active.length}</strong></div><div class="ri-card"><small>Meseros</small><strong>${serviceStaff}</strong></div><div class="ri-card"><small>Producción</small><strong>${productionStaff}</strong></div><div class="ri-card"><small>Cajeros</small><strong>${cashStaff}</strong></div></div>
        <div class="employees-toolbar"><input class="ri-input employees-search" data-employee-search placeholder="Buscar por nombre, correo, rol o asignación" value="${esc(query)}"><select class="ri-select employees-filter" data-employee-filter><option value="TODOS">Todos los roles</option>${CREATE_ROLES.map((role) => `<option value="${role}" ${roleFilter === role ? 'selected' : ''}>${esc(roleLabel(role))}</option>`).join('')}</select></div>
        <div class="employees-grid" data-employees-grid>${visible.map(userCard).join('') || '<div class="ri-card"><b>No hay empleados con este filtro.</b></div>'}</div>
      </section>`;
      $('[data-new-employee]', root)?.addEventListener('click', () => openEmployeeDialog(null));
      $('[data-employee-search]', root)?.addEventListener('input', (event) => {
        query = event.target.value;
        const rows = applyFilters(users);
        $('[data-employees-grid]', root).innerHTML = rows.map(userCard).join('') || '<div class="ri-card"><b>No hay empleados con este filtro.</b></div>';
        bindCards(root, rows);
      });
      $('[data-employee-filter]', root)?.addEventListener('change', (event) => {
        roleFilter = event.target.value;
        const rows = applyFilters(users);
        $('[data-employees-grid]', root).innerHTML = rows.map(userCard).join('') || '<div class="ri-card"><b>No hay empleados con este filtro.</b></div>';
        bindCards(root, rows);
      });
      bindCards(root, visible);
    } catch (error) { root.innerHTML = `<div class="ri-error">${esc(error.message)}</div>`; }
  }

  function checkbox(name, value, label, detail, checked) {
    return `<label class="employee-check"><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}><span><b>${esc(label)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</span></label>`;
  }

  function scopeMarkup(role, profile, opts) {
    const normalizedRole = String(role || '').toUpperCase();
    if (normalizedRole === 'MESERO') {
      const selectedZones = new Set(profile?.zoneIds || []);
      const selectedTables = new Set(profile?.tableIds || []);
      return `<section class="employee-scope" data-employee-scope data-role="MESERO">
        <div class="employee-scope-head"><div><h3>Asignación principal del mesero</h3><p>Marca zonas completas, mesas puntuales o ambas. En la tablet aparecerán primero y destacadas.</p></div><span class="employee-flex-pill">REFUERZO SIEMPRE LIBRE</span></div>
        <div class="employee-scope-block"><strong>Zonas principales</strong><div class="employee-check-grid">${(opts.zones || []).map((zone) => checkbox('zoneIds', zone.id, zone.name, 'Prioriza todas las mesas de esta zona', selectedZones.has(zone.id))).join('') || '<span class="ri-muted">No hay zonas creadas.</span>'}</div></div>
        <div class="employee-scope-block"><strong>Mesas puntuales (opcional)</strong><div class="employee-check-grid">${(opts.tables || []).map((table) => checkbox('tableIds', table.id, table.name, `${table.zoneName} · ${table.code}`, selectedTables.has(table.id))).join('') || '<span class="ri-muted">No hay mesas creadas.</span>'}</div></div>
        <div class="employee-scope-note"><b>Importante:</b> esto es una prioridad de trabajo, no un candado. El mesero seguirá viendo todas las zonas y mesas y podrá apoyar donde sea necesario.</div>
      </section>`;
    }
    if (PRODUCTION_ROLES.includes(normalizedRole)) {
      const selected = new Set(profile?.stations?.length ? profile.stations : [normalizedRole]);
      return `<section class="employee-scope" data-employee-scope data-role="${esc(normalizedRole)}">
        <div class="employee-scope-head"><div><h3>Módulos de producción</h3><p>Una misma persona puede tener Cocina, Barra, Postres o cualquier combinación.</p></div><span class="employee-flex-pill">REFUERZO SIEMPRE LIBRE</span></div>
        <div class="employee-check-grid">${(opts.stations || []).map((station) => checkbox('stations', station.code, station.label, 'Se muestra como módulo principal', selected.has(station.code))).join('')}</div>
        <div class="employee-scope-note">Al entrar verá primero sus módulos asignados. Si hace falta apoyo, podrá tocar <b>Ver todas las estaciones</b> y reforzar otro módulo sin cambiar el usuario.</div>
      </section>`;
    }
    return `<section class="employee-scope" data-employee-scope><div class="employee-scope-head"><div><h3>Asignación operativa</h3><p>Este rol no necesita zonas, mesas ni módulos de producción.</p></div></div></section>`;
  }

  function scopePayload(form, role) {
    const checked = (name) => $$(`input[name="${name}"]:checked`, form).map((input) => input.value);
    if (role === 'MESERO') return { zoneIds:checked('zoneIds'), tableIds:checked('tableIds'), stations:[] };
    if (PRODUCTION_ROLES.includes(role)) return { zoneIds:[], tableIds:[], stations:checked('stations') };
    return { zoneIds:[], tableIds:[], stations:[] };
  }

  async function openEmployeeDialog(row = null) {
    const editing = Boolean(row);
    const self = row?.id === session.user?.id;
    const dialog = ensureDialog();
    const selectedRole = CREATE_ROLES.includes(row?.rol) ? row.rol : 'MESERO';
    dialog.innerHTML = '<div class="employee-dialog-body"><div class="ri-muted">Cargando zonas, mesas y módulos…</div></div>';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open','');

    try {
      const opts = await loadAssignmentOptions();
      const profile = editing ? (profileByUser.get(row.id) || await api(`/api/v1/restaurante/empleados/${row.id}/asignacion`)) : null;
      dialog.innerHTML = `<div class="employee-dialog-head"><div><div class="ri-eyebrow">${editing ? 'EDITAR EMPLEADO' : 'NUEVO EMPLEADO'}</div><h2 style="margin:3px 0">${editing ? esc(row.nombre) : 'Crear acceso de trabajo'}</h2></div><button type="button" class="ri-btn" data-employee-close>Cerrar</button></div>
        <form class="employee-dialog-body" data-employee-form><div class="employee-fields">
          <label class="employee-field full">Nombre<input class="ri-input" name="nombre" maxlength="100" required value="${esc(row?.nombre || '')}" placeholder="Nombre y apellido"></label>
          <label class="employee-field full">Correo<input class="ri-input" type="email" name="email" maxlength="254" required value="${esc(row?.email || '')}" placeholder="empleado@restaurante.com"></label>
          <label class="employee-field">Rol<select class="ri-select" name="rol" ${self ? 'disabled' : ''}>${roleOptions(selectedRole)}</select></label>
          <label class="employee-field">Estado<select class="ri-select" name="activo" ${self ? 'disabled' : ''}><option value="1" ${row?.activo !== false ? 'selected' : ''}>Activo</option><option value="0" ${row?.activo === false ? 'selected' : ''}>Inactivo</option></select></label>
          <label class="employee-field full">${editing ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}<input class="ri-input" type="password" name="password" minlength="8" maxlength="128" ${editing ? '' : 'required'} placeholder="Mínimo 8 caracteres"></label>
          <div data-scope-host class="employee-field full">${scopeMarkup(selectedRole, profile, opts)}</div>
        </div>
        ${self ? '<div class="ri-muted">Por seguridad, tu propio rol y estado no se cambian desde esta pantalla.</div>' : ''}
        <div data-employee-message></div><div class="employee-form-actions"><button type="button" class="ri-btn" data-employee-close>Cancelar</button><button type="submit" class="ri-btn primary">${editing ? 'GUARDAR CAMBIOS' : 'CREAR EMPLEADO'}</button></div></form>`;

      $$('[data-employee-close]', dialog).forEach((button) => button.addEventListener('click', () => dialog.close?.()));
      const formNode = $('[data-employee-form]', dialog);
      const roleSelect = $('select[name="rol"]', formNode);
      roleSelect?.addEventListener('change', () => {
        const nextRole = roleSelect.value;
        const host = $('[data-scope-host]', formNode);
        if (host) host.innerHTML = scopeMarkup(nextRole, nextRole === selectedRole ? profile : null, opts);
      });

      formNode?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const payload = {
          nombre:String(form.get('nombre') || '').trim(),
          email:String(form.get('email') || '').trim().toLowerCase()
        };
        if (!self) {
          payload.rol = String(form.get('rol') || selectedRole);
          payload.activo = String(form.get('activo') || '1') === '1';
        }
        const password = String(form.get('password') || '');
        if (password) payload.password = password;
        const finalRole = self ? String(row?.rol || selectedRole) : String(payload.rol || selectedRole);
        const assignment = scopePayload(event.currentTarget, finalRole);
        const message = $('[data-employee-message]', dialog);
        const submit = event.currentTarget.querySelector('button[type="submit"]');
        submit.disabled = true;
        message.innerHTML = '<div class="ri-muted">Guardando usuario y asignación…</div>';
        try {
          const saved = editing
            ? await api(`/api/v1/usuarios/${row.id}`, { method:'PATCH', body:JSON.stringify(payload) })
            : await api('/api/v1/usuarios', { method:'POST', body:JSON.stringify({ ...payload, rol:payload.rol || 'MESERO', activo:payload.activo !== false }) });
          if (saved?.id) await api(`/api/v1/restaurante/empleados/${saved.id}/asignacion`, { method:'PUT', body:JSON.stringify(assignment) });
          dialog.close?.();
          assignmentOptions = null;
          await renderEmployees(false);
          if (!editing && saved?.rol === 'MESERO' && confirm(`${saved.nombre} fue creado como Mesero. ¿Conectar una tablet o celular ahora?`)) {
            window.VantixGCWaiterDeviceAdmin?.open?.(saved.id);
          }
        } catch (error) {
          message.innerHTML = `<div class="ri-error">${esc(error.message)}</div>`;
          submit.disabled = false;
        }
      });
    } catch (error) {
      dialog.innerHTML = `<div class="employee-dialog-head"><h2>No se pudo abrir Empleados</h2><button type="button" class="ri-btn" onclick="this.closest('dialog').close()">Cerrar</button></div><div class="employee-dialog-body"><div class="ri-error">${esc(error.message)}</div></div>`;
    }
  }

  injectStyles();
  window.VantixGCRestaurantEmployees = Object.freeze({ marker:MARKER, open:(pushState = true) => renderEmployees(pushState) });
})();
