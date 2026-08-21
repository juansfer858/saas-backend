(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  let accessChecked = false;
  let hasAccess = false;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function openFullCoreRoute(path, event) {
    event?.preventDefault?.();
    window.location.href = path;
  }

  // The legacy panel SPA still contains a lightweight PUC-only renderer for
  // /app/contabilidad. Shared Core modules must never be shadowed by those
  // lightweight panel views: force full document navigation to the canonical
  // Core surfaces used by every tenant.
  function installCoreNavigationParity() {
    const nav = document.querySelector('.sidebar .nav');
    if (!nav) return;

    const accountingLink = [...nav.querySelectorAll('a')]
      .find((a) => a.getAttribute('href') === '/app/contabilidad');
    if (accountingLink && accountingLink.dataset.coreFullRoute !== 'true') {
      const replacement = accountingLink.cloneNode(true);
      replacement.removeAttribute('data-nav');
      replacement.dataset.coreFullRoute = 'true';
      const label = replacement.querySelector('span:last-child');
      if (label) label.textContent = 'Contabilidad';
      replacement.addEventListener('click', (event) => openFullCoreRoute('/app/contabilidad', event));
      accountingLink.replaceWith(replacement);
    }

    if (!nav.querySelector('[data-core-advanced-config]')) {
      const link = document.createElement('a');
      link.href = '/app/configuracion-avanzada';
      link.dataset.coreAdvancedConfig = 'true';
      link.innerHTML = '<span class="icon">🧩</span><span>Configuración avanzada</span>';
      link.addEventListener('click', (event) => openFullCoreRoute('/app/configuracion-avanzada', event));
      const configLink = [...nav.querySelectorAll('a')]
        .find((a) => a.getAttribute('href') === '/app/configuracion');
      if (configLink) configLink.insertAdjacentElement('afterend', link);
      else nav.appendChild(link);
    }
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
    openFullCoreRoute('/app/restaurante', event);
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
    installCoreNavigationParity();
    await checkRestaurantAccess();
    installCoreNavigationParity();
    installNavEntry();
  }

  const observer = new MutationObserver(() => {
    installCoreNavigationParity();
    installNavEntry();
  });
  window.addEventListener('load', () => {
    const root = document.querySelector('#root');
    if (root) observer.observe(root, { childList: true, subtree: true });
    installCoreNavigationParity();
    refreshEntry();
  });
  setTimeout(refreshEntry, 100);
})();