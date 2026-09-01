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
      const [realtime, realtimePanel, core] = await Promise.all([
        fetchRuntime('/app/vantix-tenant-realtime.js?v=tenant-realtime-v1'),
        fetchRuntime('/app/core-realtime-panel-ui.js?v=core-realtime-v1'),
        fetchRuntime('/api/v1/comercial/ui-runtime/panel-integration-extras-core.js')
      ]);
      executeSource(realtime, 'vantix-tenant-realtime.js');
      executeSource(realtimePanel, 'core-realtime-panel-ui.js');
      executeSource(core, 'panel-integration-extras-core.js');
    } catch (error) {
      console.error('SUPER_CORE_INTEGRATION_RUNTIME_ERROR', error);
    }
  }

  start();
})();
