(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;

  const isAdmin = ['ADMIN','SUPER_ADMIN'].includes(String(session.user?.rol || '').toUpperCase());
  const $ = (query, root = document) => root.querySelector(query);
  const $$ = (query, root = document) => [...root.querySelectorAll(query)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const ROLE_INFO = Object.freeze({
    MESERO: ['Mesero', 'Mesas, pedidos y domicilios'],
    COCINA: ['Cocina', 'Comandas de cocina'],
    BARRA: ['Barra', 'Comandas de barra'],
    POSTRES: ['Postres', 'Comandas de postres'],
    CAJERO: ['Cajero', 'Caja, cobros y recaudos'],
    ADMIN: ['Administrador', 'Administración completa del restaurante'],
    CONTADOR: ['Contador', 'Contabilidad y reportes financieros'],
    SUPER_ADMIN: ['Super administrador', 'Cuenta protegida de plataforma']
  });
  const CREATE_ROLES = ['MESERO','COCINA','BARRA','POSTRES','CAJERO','ADMIN','CONTADOR'];
  let query = '';
  let roleFilter = 'TODOS';

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
      .employee-dialog{width:min(650px,calc(100vw - 22px));max-height:92dvh;padding:0;border:0;border-radius:18px;overflow:auto}.employee-dialog::backdrop{background:rgb(15 23 42 / .5)}.employee-dialog-head{position:sticky;top:0;z-index:2;padding:17px 19px;border-bottom:1px solid var(--cc-line);background:var(--paper,#fff);display:flex;justify-content:space-between;gap:12px}.employee-dialog-body{padding:18px 19px;display:grid;gap:13px}.employee-fields{display:grid;grid-template-columns:1fr 1fr;gap:11px}.employee-field{display:grid;gap:6px;font-weight:800;font-size:12px}.employee-field.full{grid-column:1/-1}.employee-field input,.employee-field select{width:100%;min-height:49px}.employee-form-actions{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap}
      @media(max-width:760px){.employees-head{display:grid}.employees-summary{grid-template-columns:1fr 1fr}.employees-grid{grid-template-columns:1fr}.employee-fields{grid-template-columns:1fr}.employee-field.full{grid-column:auto}.employees-filter{flex:1 1 180px}.employee-form-actions .ri-btn{width:100%;min-height:50px}}
      @media(pointer:coarse){.employee-actions .ri-btn,.employees-toolbar .ri-btn{min-height:48px}}
    `;
    document.head.appendChild(style);
  }

  function roleLabel(role) { return ROLE_INFO[role]?.[0] || role || 'Sin rol'; }
  function roleDescription(role) { return ROLE_INFO[role]?.[1] || 'Rol de otro módulo del Core'; }
  function roleOptions(selected) {
    return CREATE_ROLES.map((role) => `<option value="${role}" ${role === selected ? 'selected' : ''}>${esc(roleLabel(role))}</option>`).join('');
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
    return `<article class="ri-card employee-card" data-employee-card="${esc(row.id)}">
      <div class="employee-card-head"><div><h3>${esc(row.nombre)}</h3><small>${esc(row.email)}</small></div><div style="text-align:right"><span class="employee-status">${row.activo ? '● ACTIVO' : '○ INACTIVO'}</span>${self ? '<div class="employee-self">TU CUENTA</div>' : ''}</div></div>
      <div><div class="employee-role">${esc(roleLabel(row.rol))}</div><div class="employee-role-desc">${esc(roleDescription(row.rol))}</div></div>
      <div class="employee-actions">${!manageableRole ? '<span class="ri-muted">Rol administrado fuera de Restaurante</span>' : `<button type="button" class="ri-btn small" data-employee-edit="${esc(row.id)}">Editar</button>${row.rol === 'MESERO' && row.activo ? `<button type="button" class="ri-btn small secondary" data-employee-connect="${esc(row.id)}">▣ Conectar tablet/celular</button>` : ''}${!self ? `<button type="button" class="ri-btn small ${row.activo ? 'danger' : 'secondary'}" data-employee-toggle="${esc(row.id)}" data-active="${row.activo ? '1' : '0'}">${row.activo ? 'Desactivar' : 'Activar'}</button>` : ''}`}</div>
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
      const haystack = `${user.nombre} ${user.email} ${roleLabel(user.rol)}`.toLowerCase();
      return matchRole && (!q || haystack.includes(q));
    });
  }

  async function renderEmployees(pushState = true) {
    injectStyles();
    const root = window.VantixGCRestaurantControlCenter?.openCustomView?.('empleados', pushState);
    if (!root) return;
    if (!isAdmin) {
      root.innerHTML = '<div class="ri-error">Sólo Administrador puede gestionar empleados.</div>';
      return;
    }
    root.innerHTML = '<div class="ri-muted">Cargando empleados…</div>';
    try {
      const response = await api('/api/v1/usuarios');
      const users = Array.isArray(response) ? response : [];
      const active = users.filter((user) => user.activo);
      const serviceStaff = active.filter((user) => user.rol === 'MESERO').length;
      const productionStaff = active.filter((user) => ['COCINA','BARRA','POSTRES'].includes(user.rol)).length;
      const cashStaff = active.filter((user) => user.rol === 'CAJERO').length;
      const visible = applyFilters(users);
      root.innerHTML = `<section class="employees-shell">
        <header class="employees-head"><div><div class="ri-eyebrow">PERSONAL DEL RESTAURANTE</div><h1>Empleados</h1><p>Crea cada usuario con su función. El sistema le muestra sólo lo que necesita para trabajar.</p></div><button type="button" class="ri-btn primary" data-new-employee>+ NUEVO EMPLEADO</button></header>
        <div class="employees-summary"><div class="ri-card"><small>Activos</small><strong>${active.length}</strong></div><div class="ri-card"><small>Meseros</small><strong>${serviceStaff}</strong></div><div class="ri-card"><small>Cocina / Barra</small><strong>${productionStaff}</strong></div><div class="ri-card"><small>Cajeros</small><strong>${cashStaff}</strong></div></div>
        <div class="employees-toolbar"><input class="ri-input employees-search" data-employee-search placeholder="Buscar por nombre, correo o rol" value="${esc(query)}"><select class="ri-select employees-filter" data-employee-filter><option value="TODOS">Todos los roles</option>${CREATE_ROLES.map((role) => `<option value="${role}" ${roleFilter === role ? 'selected' : ''}>${esc(roleLabel(role))}</option>`).join('')}</select></div>
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
    } catch (error) {
      root.innerHTML = `<div class="ri-error">${esc(error.message)}</div>`;
    }
  }

  async function openEmployeeDialog(row = null) {
    const editing = Boolean(row);
    const self = row?.id === session.user?.id;
    const dialog = ensureDialog();
    const selectedRole = CREATE_ROLES.includes(row?.rol) ? row.rol : 'MESERO';
    dialog.innerHTML = `<div class="employee-dialog-head"><div><div class="ri-eyebrow">${editing ? 'EDITAR EMPLEADO' : 'NUEVO EMPLEADO'}</div><h2 style="margin:3px 0">${editing ? esc(row.nombre) : 'Crear acceso de trabajo'}</h2></div><button type="button" class="ri-btn" data-employee-close>Cerrar</button></div>
      <form class="employee-dialog-body" data-employee-form><div class="employee-fields">
        <label class="employee-field full">Nombre<input class="ri-input" name="nombre" maxlength="100" required value="${esc(row?.nombre || '')}" placeholder="Nombre y apellido"></label>
        <label class="employee-field full">Correo<input class="ri-input" type="email" name="email" maxlength="254" required value="${esc(row?.email || '')}" placeholder="empleado@restaurante.com"></label>
        <label class="employee-field">Rol<select class="ri-select" name="rol" ${self ? 'disabled' : ''}>${roleOptions(selectedRole)}</select></label>
        <label class="employee-field">Estado<select class="ri-select" name="activo" ${self ? 'disabled' : ''}><option value="1" ${row?.activo !== false ? 'selected' : ''}>Activo</option><option value="0" ${row?.activo === false ? 'selected' : ''}>Inactivo</option></select></label>
        <label class="employee-field full">${editing ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}<input class="ri-input" type="password" name="password" minlength="8" maxlength="128" ${editing ? '' : 'required'} placeholder="Mínimo 8 caracteres"></label>
      </div>
      ${self ? '<div class="ri-muted">Por seguridad, tu propio rol y estado no se cambian desde esta pantalla.</div>' : ''}
      <div data-employee-message></div><div class="employee-form-actions"><button type="button" class="ri-btn" data-employee-close>Cancelar</button><button type="submit" class="ri-btn primary">${editing ? 'GUARDAR CAMBIOS' : 'CREAR EMPLEADO'}</button></div></form>`;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open','');
    $$('[data-employee-close]', dialog).forEach((button) => button.addEventListener('click', () => dialog.close?.()));
    $('[data-employee-form]', dialog)?.addEventListener('submit', async (event) => {
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
      const message = $('[data-employee-message]', dialog);
      const submit = event.currentTarget.querySelector('button[type="submit"]');
      submit.disabled = true;
      message.innerHTML = '<div class="ri-muted">Guardando…</div>';
      try {
        const saved = editing
          ? await api(`/api/v1/usuarios/${row.id}`, { method:'PATCH', body:JSON.stringify(payload) })
          : await api('/api/v1/usuarios', { method:'POST', body:JSON.stringify({ ...payload, rol:payload.rol || 'MESERO', activo:payload.activo !== false }) });
        dialog.close?.();
        await renderEmployees(false);
        if (!editing && saved?.rol === 'MESERO' && confirm(`${saved.nombre} fue creado como Mesero. ¿Conectar una tablet o celular ahora?`)) {
          window.VantixGCWaiterDeviceAdmin?.open?.(saved.id);
        }
      } catch (error) {
        message.innerHTML = `<div class="ri-error">${esc(error.message)}</div>`;
        submit.disabled = false;
      }
    });
  }

  injectStyles();
  window.VantixGCRestaurantEmployees = Object.freeze({ open: (pushState = true) => renderEmployees(pushState) });
})();
