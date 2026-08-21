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

  function enhanceTenantRows() {
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
