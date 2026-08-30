(() => {
  'use strict';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const RUNTIME_URL = '/app/restaurant-waiter-runtime-v7.js?v=waiter-runtime-v8';

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function tokenPayload(token) {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return null;
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
      return JSON.parse(decodeURIComponent(escape(atob(normalized))));
    } catch { return null; }
  }

  async function renewIfNeeded(session) {
    if (!session?.token || !session?.subdomain) return session;
    const payload = tokenPayload(session.token);
    if (session.persistent === true && !payload?.exp) return session;
    try {
      const response = await fetch('/api/v1/restaurante/dispositivos-mesero/renovar-sesion', {
        method:'POST',
        cache:'no-store',
        headers:{
          'Content-Type':'application/json',
          Authorization:`Bearer ${session.token}`,
          'x-tenant-subdomain':session.subdomain
        },
        body:'{}'
      });
      if (!response.ok) return session;
      const body = await response.json().catch(() => null);
      const renewed = body?.data?.session;
      if (!renewed?.token) return session;
      const merged = { ...session, ...renewed, persistent:true };
      localStorage.setItem(SESSION_KEY, JSON.stringify(merged));
      return merged;
    } catch { return session; }
  }

  function loadRuntime() {
    const script = document.createElement('script');
    script.src = RUNTIME_URL;
    script.async = false;
    script.dataset.waiterRuntimeLoader = 'v8';
    script.onerror = () => {
      const app = document.querySelector('#wvApp');
      if (app) app.innerHTML = '<section class="wv-card wv-empty"><b>No se pudo cargar Mesero</b><span>Revisa la conexión y vuelve a abrir la aplicación.</span></section>';
    };
    document.body.appendChild(script);
  }

  renewIfNeeded(readSession()).finally(loadRuntime);
  window.VantixGCWaiterSessionV8 = Object.freeze({ version:'8.0.0', persistent:true, renewIfNeeded });
})();
