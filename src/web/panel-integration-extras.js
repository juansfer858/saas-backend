(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const DASHBOARD_PATH = '/app/dashboard';

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
      .core-dashboard-actions{margin-left:auto!important;display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important}
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

  function installDashboardNavigationReload() {
    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href="/app/dashboard"]');
      if (!link || window.location.pathname === DASHBOARD_PATH) return;
      event.preventDefault();
      window.location.assign(DASHBOARD_PATH);
    }, true);
  }

  function filenameFromDisposition(disposition, format) {
    const match = String(disposition || '').match(/filename="?([^";]+)"?/i);
    if (match?.[1]) return match[1];
    return `Informe_Dashboard.${format === 'pdf' ? 'pdf' : 'xls'}`;
  }

  async function exportDashboard(format, button) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) return;
    const original = button?.textContent || '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Generando…';
    }
    try {
      const offset = new Date().getTimezoneOffset();
      const response = await fetch(`/api/v1/comercial/ventas/dashboard/exportar?formato=${encodeURIComponent(format)}&tzOffsetMinutes=${encodeURIComponent(offset)}`, {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'x-tenant-subdomain': session.subdomain
        }
      });
      if (!response.ok) {
        let body = {};
        try { body = await response.json(); } catch {}
        throw new Error(body?.error?.message || body?.message || `No fue posible generar el informe (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filenameFromDisposition(response.headers.get('content-disposition'), format);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      window.alert(`No fue posible exportar el Dashboard. ${error.message}`);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  function ensureDashboardExportActions() {
    if (window.location.pathname !== DASHBOARD_PATH) return true;
    const pagehead = document.querySelector('.core-dash-pagehead');
    if (!pagehead) return false;

    let actions = pagehead.querySelector('[data-dashboard-actions]');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'actions core-dashboard-actions';
      actions.dataset.dashboardActions = 'base-export-v1';
      actions.innerHTML = '<button class="btn" type="button" data-dashboard-refresh-visible>Actualizar</button><button class="btn" type="button" data-dashboard-direct-export="excel">Exportar Excel</button><button class="btn primary" type="button" data-dashboard-direct-export="pdf">Exportar PDF</button>';
      pagehead.appendChild(actions);
      actions.querySelector('[data-dashboard-refresh-visible]')?.addEventListener('click', () => window.location.reload());
      actions.querySelector('[data-dashboard-direct-export="excel"]')?.addEventListener('click', (event) => exportDashboard('excel', event.currentTarget));
      actions.querySelector('[data-dashboard-direct-export="pdf"]')?.addEventListener('click', (event) => exportDashboard('pdf', event.currentTarget));
    }

    return Boolean(document.querySelector('[data-core-dashboard-analytics]') && pagehead.querySelector('[data-dashboard-actions]'));
  }

  function installPersistentDashboardExportActions() {
    if (window.location.pathname !== DASHBOARD_PATH) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (ensureDashboardExportActions() || attempts >= 120 || window.location.pathname !== DASHBOARD_PATH) clearInterval(timer);
    }, 125);
    ensureDashboardExportActions();
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
    installDashboardNavigationReload();
    installPersistentDashboardExportActions();
    try {
      const core = await fetchRuntime('/api/v1/comercial/ui-runtime/panel-integration-extras-core.js');
      executeSource(core, 'panel-integration-extras-core.js');
      const dashboard = await fetchRuntime('/api/v1/comercial/ui-runtime/dashboard-interactions.js');
      executeSource(dashboard, 'dashboard-interactions.js');
    } catch (error) {
      console.error('SUPER_CORE_UI_RUNTIME_ERROR', error);
    } finally {
      ensureDashboardExportActions();
    }
  }

  start();
})();
