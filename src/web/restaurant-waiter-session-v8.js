(() => {
  'use strict';
  const SESSION_KEY = 'vantixgc_core_session_v1';

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
      document.documentElement.dataset.waiterPersistent = '1';
      return merged;
    } catch { return session; }
  }

  renewIfNeeded(readSession());
  window.VantixGCWaiterSessionV8 = Object.freeze({ version:'8.0.0', persistent:true, renewIfNeeded });
})();
