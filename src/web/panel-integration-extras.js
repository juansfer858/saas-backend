(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
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
