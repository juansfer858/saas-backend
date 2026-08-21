(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  let accessChecked = false;
  let hasAccess = false;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  async function checkRestaurantAccess() {
    if (accessChecked) return hasAccess;
    accessChecked = true;
    const session = readSession();
    if (!session?.token || !session?.subdomain) return false;
    try {
      const response = await fetch('/api/v1/restaurante/ui-context', {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'x-tenant-subdomain': session.subdomain
        }
      });
      if (!response.ok) return false;
      const body = await response.json();
      hasAccess = Boolean(body?.ok && body?.data?.permissions);
      return hasAccess;
    } catch {
      return false;
    }
  }

  function openRestaurant(event) {
    event?.preventDefault?.();
    window.location.href = '/app/restaurante';
  }

  function installNavEntry() {
    if (!hasAccess) return;
    const nav = document.querySelector('.sidebar .nav');
    if (nav && !nav.querySelector('[data-restaurant-entry]')) {
      const link = document.createElement('a');
      link.href = '/app/restaurante';
      link.dataset.restaurantEntry = 'true';
      link.innerHTML = '<span class="icon">🍽</span><span>Restaurante</span>';
      link.addEventListener('click', openRestaurant);
      const configLink = [...nav.querySelectorAll('a')].find((a) => a.textContent.includes('Configuración'));
      if (configLink) nav.insertBefore(link, configLink);
      else nav.appendChild(link);
    }

    if (location.pathname === '/app/dashboard') {
      const actions = document.querySelector('.pagehead .actions');
      if (actions && !actions.querySelector('[data-restaurant-dashboard-entry]')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn';
        button.dataset.restaurantDashboardEntry = 'true';
        button.textContent = '🍽 Abrir Restaurante';
        button.addEventListener('click', openRestaurant);
        actions.prepend(button);
      }
    }
  }

  async function refreshEntry() {
    await checkRestaurantAccess();
    installNavEntry();
  }

  const observer = new MutationObserver(() => installNavEntry());
  window.addEventListener('load', () => {
    const root = document.querySelector('#root');
    if (root) observer.observe(root, { childList: true, subtree: true });
    refreshEntry();
  });
  setTimeout(refreshEntry, 100);
})();
