(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V1_RETIREMENT_LAUNCH_P11';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const FALLBACK = '/app/centro-de-control-p10';
  document.documentElement.dataset.restaurantV1RetirementLaunch = MARKER;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }
  function destination(path) {
    const query = location.search || '';
    return `${path}${query}`;
  }
  async function boot() {
    const message = document.getElementById('launchMessage');
    const session = readSession();
    if (!session?.token || !session?.subdomain) {
      location.replace('/app');
      return;
    }
    try {
      const response = await fetch('/api/v1/restaurante/v2/retiro-v1/launch', {
        cache:'no-store',
        headers:{ Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain }
      });
      let body = {}; try { body = await response.json(); } catch {}
      if (response.status === 401) {
        localStorage.removeItem(SESSION_KEY);
        location.replace('/app');
        return;
      }
      if (!response.ok || !body?.data?.target) throw new Error(body?.error?.message || `HTTP ${response.status}`);
      const target = String(body.data.target);
      if (!['/app/centro-de-control-v2','/app/centro-de-control-p10'].includes(target)) throw new Error('Destino P11 inválido');
      if (message) message.textContent = body.data.enabled ? 'Abriendo operación V2…' : 'Abriendo compatibilidad P10…';
      location.replace(destination(target));
    } catch (error) {
      if (message) message.textContent = 'No fue posible leer P11. Abriendo compatibilidad segura…';
      setTimeout(() => location.replace(destination(FALLBACK)), 250);
    }
  }

  boot();
})();
