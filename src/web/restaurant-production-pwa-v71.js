'use strict';

(() => {
  const MARKER = 'VANTIX_RESTAURANT_PRODUCTION_PWA_V71';
  const STORAGE_KEY = 'vantixgc_restaurant_production_device_v63';
  let deferredInstallPrompt = null;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch { return null; }
  }

  function roleLabel() {
    const session = readSession();
    const role = String(session?.user?.rol || session?.station || '').toUpperCase();
    if (role === 'COCINA') return 'Cocina';
    if (role === 'BARRA') return 'Barra';
    if (role === 'POSTRES') return 'Postres';
    return 'Producción';
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  }

  function isIos() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function removeInstallButton() {
    document.getElementById('installProductionApp')?.remove();
  }

  function ensureInstallButton() {
    if (isStandalone()) {
      removeInstallButton();
      return;
    }
    const toolbar = document.querySelector('.toolbar');
    if (!toolbar || document.getElementById('installProductionApp')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'installProductionApp';
    button.className = 'btn primary';
    button.textContent = `⬇ Instalar ${roleLabel()}`;
    button.title = 'Instalar esta estación como aplicación en el dispositivo';
    button.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try {
          const choice = await deferredInstallPrompt.userChoice;
          if (choice?.outcome === 'accepted') {
            deferredInstallPrompt = null;
            removeInstallButton();
          }
        } catch {}
        return;
      }

      if (isIos()) {
        alert('Para instalar esta estación en iPhone o iPad: toca Compartir y luego “Añadir a pantalla de inicio”.');
        return;
      }

      alert('La aplicación ya está preparada para instalarse. En Chrome toca el menú ⋮ y elige “Instalar aplicación” o “Añadir a pantalla principal”. Si acabas de vincular la tablet, espera unos segundos y vuelve a pulsar este botón.');
    });
    toolbar.appendChild(button);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    ensureInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    removeInstallButton();
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/app/produccion/sw.js', { scope: '/app/produccion' })
      .then((registration) => {
        window[MARKER] = Object.freeze({
          version: '71.0.0',
          installable: true,
          scope: registration.scope,
          station: roleLabel(),
          apiCache: false,
          pairingTokenCache: false
        });
        ensureInstallButton();
      })
      .catch((error) => {
        console.error('VANTIX_PRODUCTION_PWA_SW_ERROR', error);
        ensureInstallButton();
      });
  } else {
    ensureInstallButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureInstallButton, { once: true });
  } else {
    ensureInstallButton();
  }
})();
