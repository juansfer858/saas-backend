(() => {
  const SESSION_KEY = 'vantixgc_platform_session_v1';
  const WARNING = 'Los documentos emitidos en modo fiscal simulado NO tienen validez fiscal ante la DIAN. No deben entregarse ni presentarse como si hubieran sido validados fiscalmente por la DIAN.';

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }

  async function platformApi(path, opts = {}) {
    const current = session();
    if (!current?.token) throw new Error('Sesión de plataforma requerida.');
    const response = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${current.token}`,
        ...(opts.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function modalRoot() {
    return document.querySelector('#modal');
  }

  function close() {
    const root = modalRoot();
    if (root) root.innerHTML = '';
  }

  async function openTenantProvisioning() {
    const root = modalRoot();
    if (!root) return;
    root.innerHTML = '<div class="modal-back"><div class="modal"><p>Cargando plantillas de tenant…</p></div></div>';
    try {
      const templates = await platformApi('/platform/api/tenant-templates');
      const available = templates.filter((x) => x.available);
      const coming = templates.filter((x) => !x.available);
      root.innerHTML = `<div class="modal-back"><div class="modal">
        <h2>Crear nuevo tenant</h2>
        <p class="muted">El Core crea empresa, ADMIN, PUC, Caja General, tercero genérico, RBAC, impresión y control SaaS en una sola transacción. El subdominio se reserva automáticamente desde el nombre del negocio.</p>
        <div class="grid">
          <div class="field" style="grid-column:span 2"><label>Nombre del negocio</label><input class="input" id="tpBusiness" maxlength="120" placeholder="Ej. Restaurante El Parque"></div>
          <div class="field"><label>Plantilla</label><select class="select" id="tpTemplate">${available.map((t) => `<option value="${esc(t.code)}">${esc(t.label)}</option>`).join('')}</select></div>
          <div class="field"><label>NIT (opcional)</label><input class="input" id="tpNit" maxlength="40"></div>
          <div class="field"><label>País</label><input class="input" id="tpCountry" value="CO" maxlength="2"></div>
          <div class="field"><label>Moneda</label><input class="input" id="tpCurrency" value="COP" maxlength="3"></div>
        </div>
        <h3 style="margin-top:22px">Administrador inicial del tenant</h3>
        <div class="grid">
          <div class="field"><label>Nombre</label><input class="input" id="tpAdminName" maxlength="100"></div>
          <div class="field"><label>Correo</label><input class="input" id="tpAdminEmail" type="email" maxlength="254"></div>
          <div class="field"><label>Contraseña inicial</label><input class="input" id="tpAdminPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password"></div>
        </div>
        <div class="notice">La contraseña no se registra en auditoría ni se devuelve por API. Master la define aquí y debe entregarla al administrador del negocio por su canal operativo seguro.</div>
        ${coming.length ? `<div class="muted">Próximamente: ${coming.map((t) => esc(t.label)).join(', ')}. No se puede seleccionar hasta que su plantilla esté aprobada.</div>` : ''}
        <div id="tpError"></div>
        <div class="toolbar" style="justify-content:flex-end;margin-top:16px">
          <button class="btn" id="tpCancel">Cancelar</button>
          <button class="btn primary" id="tpCreate">Crear tenant</button>
        </div>
      </div></div>`;
      document.querySelector('#tpCancel').onclick = close;
      document.querySelector('#tpCreate').onclick = async () => {
        const errorBox = document.querySelector('#tpError');
        const body = {
          nombreEmpresa: String(document.querySelector('#tpBusiness')?.value || '').trim(),
          templateCode: document.querySelector('#tpTemplate')?.value,
          nit: String(document.querySelector('#tpNit')?.value || '').trim() || null,
          pais: String(document.querySelector('#tpCountry')?.value || 'CO').trim().toUpperCase(),
          moneda: String(document.querySelector('#tpCurrency')?.value || 'COP').trim().toUpperCase(),
          admin: {
            nombre: String(document.querySelector('#tpAdminName')?.value || '').trim(),
            email: String(document.querySelector('#tpAdminEmail')?.value || '').trim().toLowerCase(),
            password: String(document.querySelector('#tpAdminPassword')?.value || '')
          }
        };
        if (body.nombreEmpresa.length < 2 || body.admin.nombre.length < 2 || !body.admin.email || body.admin.password.length < 12) {
          errorBox.innerHTML = '<div class="error">Complete negocio, administrador, correo válido y contraseña de mínimo 12 caracteres.</div>';
          return;
        }
        if (!confirm(`Se creará un tenant real para ${body.nombreEmpresa} con plantilla ${body.templateCode}. ¿Continuar?`)) return;
        try {
          const created = await platformApi('/platform/api/tenants', { method: 'POST', body: JSON.stringify(body) });
          root.innerHTML = `<div class="modal-back"><div class="modal">
            <h2>Tenant creado</h2>
            <div class="notice"><b>${esc(created.tenant.nombreEmpresa)}</b> quedó activo y auditado.</div>
            <div class="panel"><div style="padding:14px">
              <div><b>Tenant ID:</b> ${esc(created.tenant.id)}</div>
              <div style="margin-top:7px"><b>Plantilla:</b> ${esc(created.template.label)}</div>
              <div style="margin-top:7px"><b>Subdominio:</b> ${esc(created.tenant.subdomain)}</div>
              <div style="margin-top:7px"><b>Correo ADMIN:</b> ${esc(created.admin.email)}</div>
              <div style="margin-top:7px"><b>Acceso:</b> <a href="/app" target="_blank" rel="noopener">Abrir login del tenant</a></div>
            </div></div>
            <p class="muted">La contraseña no se muestra porque fue definida por Master en el formulario y nunca es retornada por el servidor.</p>
            <div class="toolbar" style="justify-content:flex-end"><button class="btn primary" id="tpDone">Cerrar y actualizar tenants</button></div>
          </div></div>`;
          document.querySelector('#tpDone').onclick = () => {
            close();
            const refresh = document.querySelector('#refresh');
            if (refresh) refresh.click();
          };
        } catch (error) {
          errorBox.innerHTML = `<div class="error">${esc(error.message)}</div>`;
        }
      };
    } catch (error) {
      root.innerHTML = `<div class="modal-back"><div class="modal"><div class="error">${esc(error.message)}</div><button class="btn" id="tpCancel">Cerrar</button></div></div>`;
      document.querySelector('#tpCancel').onclick = close;
    }
  }

  async function openGovernance(tenantId) {
    const root = modalRoot();
    if (!root) return;
    root.innerHTML = '<div class="modal-back"><div class="modal"><p>Cargando gobernanza fiscal de Restaurante…</p></div></div>';
    try {
      const data = await platformApi(`/platform/api/tenants/${tenantId}/restaurante/fiscal-simulado`);
      const g = data.governance || {};
      const activating = !g.accepted;
      const last = g.lastDecision || null;
      root.innerHTML = `<div class="modal-back"><div class="modal">
        <h2>Gobernanza fiscal · ${esc(data.tenant?.nombreEmpresa || data.tenant?.subdomain || tenantId)}</h2>
        <div class="error" style="font-weight:700">${esc(WARNING)}</div>
        <p class="muted">Esta decisión no está disponible para administradores del tenant. Solo un super-administrador de VantixGC puede ${activating ? 'autorizar' : 'revocar'} este modo desde el Panel SaaS.</p>
        <div class="panel" style="margin:14px 0"><div style="padding:14px">
          <div><b>Estado actual:</b> ${g.accepted ? '<span class="badge bad">SIMULADO ACEPTADO</span>' : '<span class="badge ok">NO ACEPTADO</span>'}</div>
          <div style="margin-top:8px"><b>Documentos simulados ya emitidos:</b> ${Number(g.simulatedDocumentsIssued || 0)}</div>
          <div class="muted" style="margin-top:6px">Los documentos ya emitidos conservan permanentemente su marca SIMULATED aunque después se habilite DIAN real o se revoque esta autorización.</div>
        </div></div>
        ${last ? `<div class="notice"><b>Última decisión registrada</b><br>${esc(last.decidedAt || '—')} · ${esc(last.superAdminName || last.superAdminEmail || last.superAdminId || 'Super Admin')}<br>${esc(last.reason || '')}</div>` : ''}
        <div class="field"><label>Justificación obligatoria</label><textarea class="input" id="rfReason" rows="4" maxlength="1200" placeholder="Explique por qué se ${activating ? 'autoriza temporalmente operar sin DIAN real' : 'revoca la autorización fiscal simulada'} (mínimo 20 caracteres)."></textarea></div>
        ${activating ? `<label style="display:flex;gap:9px;align-items:flex-start;margin:14px 0"><input type="checkbox" id="rfAck" style="margin-top:3px"><span><b>Confirmo que entiendo la implicación.</b><br><span class="muted">Los documentos generados bajo este modo no tienen validez fiscal real ante la DIAN y el negocio no debe presentarlos como si la tuvieran.</span></span></label>` : ''}
        <div id="rfError"></div>
        <div class="toolbar" style="justify-content:flex-end;margin-top:16px">
          <button class="btn" id="rfCancel">Cancelar</button>
          <button class="btn ${activating ? 'danger' : 'primary'}" id="rfSave">${activating ? 'Autorizar modo fiscal simulado' : 'Revocar autorización simulada'}</button>
        </div>
      </div></div>`;
      document.querySelector('#rfCancel').onclick = close;
      document.querySelector('#rfSave').onclick = async () => {
        const reason = String(document.querySelector('#rfReason')?.value || '').trim();
        const acknowledgedNoDianValidity = activating ? Boolean(document.querySelector('#rfAck')?.checked) : false;
        const errorBox = document.querySelector('#rfError');
        if (reason.length < 20) {
          errorBox.innerHTML = '<div class="error">La justificación debe tener al menos 20 caracteres.</div>';
          return;
        }
        if (activating && !acknowledgedNoDianValidity) {
          errorBox.innerHTML = '<div class="error">Debe confirmar expresamente que entiende que los documentos no tienen validez fiscal DIAN.</div>';
          return;
        }
        if (activating && !confirm('Esta acción puede habilitar el gate fiscal de producción sin DIAN real. ¿Confirma la autorización bajo la advertencia mostrada?')) return;
        try {
          await platformApi(`/platform/api/tenants/${tenantId}/restaurante/fiscal-simulado`, {
            method: 'PUT',
            body: JSON.stringify({ accepted: activating, reason, acknowledgedNoDianValidity })
          });
          close();
          alert(activating ? 'Autorización fiscal simulada registrada y auditada.' : 'Autorización fiscal simulada revocada y auditada. Los documentos anteriores conservan su marca SIMULATED.');
          const refresh = document.querySelector('#refresh');
          if (refresh) refresh.click();
        } catch (error) {
          errorBox.innerHTML = `<div class="error">${esc(error.message)}</div>`;
        }
      };
    } catch (error) {
      root.innerHTML = `<div class="modal-back"><div class="modal"><div class="error">${esc(error.message)}</div><button class="btn" id="rfCancel">Cerrar</button></div></div>`;
      document.querySelector('#rfCancel').onclick = close;
    }
  }

  function installCreateTenantButton() {
    const refresh = document.querySelector('#refresh');
    const header = refresh?.parentElement;
    if (!refresh || !header || header.querySelector('[data-create-tenant]')) return;
    const button = document.createElement('button');
    button.className = 'btn primary';
    button.type = 'button';
    button.dataset.createTenant = '1';
    button.textContent = '+ Crear nuevo tenant';
    button.onclick = openTenantProvisioning;
    header.insertBefore(button, refresh);
  }

  function enhanceTenantRows() {
    installCreateTenantButton();
    document.querySelectorAll('[data-control]').forEach((controlButton) => {
      const tenantId = controlButton.dataset.control;
      const toolbar = controlButton.parentElement;
      if (!tenantId || !toolbar || toolbar.querySelector(`[data-rest-fiscal="${tenantId}"]`)) return;
      const button = document.createElement('button');
      button.className = 'btn';
      button.dataset.restFiscal = tenantId;
      button.textContent = 'Fiscal Restaurante';
      button.onclick = () => openGovernance(tenantId);
      toolbar.appendChild(button);
    });
  }

  const observer = new MutationObserver(enhanceTenantRows);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', enhanceTenantRows);
  setTimeout(enhanceTenantRows, 500);
})();
