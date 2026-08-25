(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function installDashboardInteractionStyles() {
    if (document.getElementById('core-dashboard-interaction-styles')) return;
    const style = document.createElement('style');
    style.id = 'core-dashboard-interaction-styles';
    style.textContent = `
      .core-dash-actionable{cursor:pointer!important;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease!important}
      .core-dash-actionable:hover{transform:translateY(-2px);border-color:#c9d7e8!important;box-shadow:0 10px 24px rgba(15,23,42,.08)!important}
      .core-dash-actionable:focus-visible{outline:3px solid rgba(59,130,246,.24)!important;outline-offset:2px!important}
      .core-dashboard-actions{margin-left:auto!important}
      .core-dashboard-report-modal{width:min(720px,100%)!important}
      .core-dashboard-report-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
      .core-dashboard-report-head h2{margin:0 0 4px!important}.core-dashboard-report-head p{margin:0;color:#667085;font-size:13px}
      .core-dashboard-report-sections{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0 16px}
      .core-dashboard-report-sections>div{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid #e5eaf0;border-radius:12px;background:#f8fafc}
      .core-dashboard-report-sections strong{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#eff6ff;color:#2563eb;font-size:12px}
      .core-dashboard-report-sections span{font-size:13px;font-weight:650;color:#344054}
      .core-dashboard-report-note{line-height:1.5}.core-dashboard-report-error{min-height:18px;margin:6px 0;font-size:12px}
      .core-dashboard-report-actions{justify-content:flex-end!important;margin-top:12px}
      .core-dashboard-product-modal{width:min(560px,100%)!important}
      @media(max-width:760px){.core-dashboard-actions{width:100%;margin-left:0!important}.core-dashboard-actions .btn{flex:1}.core-dashboard-report-sections{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  async function fetchRuntime(path) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) throw new Error('Sesión no disponible para runtime UI');
    const response = await fetch(path, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'x-tenant-subdomain': session.subdomain
      }
    });
    if (!response.ok) throw new Error(`Runtime UI ${response.status}: ${path}`);
    return response.text();
  }

  function executeSource(source, name) {
    const script = document.createElement('script');
    script.textContent = `${source}\n//# sourceURL=${name}`;
    document.head.appendChild(script);
    script.remove();
  }

  async function start() {
    installDashboardInteractionStyles();
    try {
      const core = await fetchRuntime('/api/v1/comercial/ui-runtime/panel-integration-extras-core.js');
      executeSource(core, 'panel-integration-extras-core.js');
      const dashboard = await fetchRuntime('/api/v1/comercial/ui-runtime/dashboard-interactions.js');
      executeSource(dashboard, 'dashboard-interactions.js');
    } catch (error) {
      console.error('SUPER_CORE_UI_RUNTIME_ERROR', error);
    }
  }

  start();
})();
