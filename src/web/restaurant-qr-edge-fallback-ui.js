(() => {
  'use strict';

  const qrToken = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  if (!qrToken) return;

  const apiPrefix = `/api/public/restaurante/qr/${encodeURIComponent(qrToken)}`;
  const previousFetch = window.fetch.bind(window);
  let localFallbackUrl = null;

  function targetUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function safeLocalUrl(value) {
    try {
      const url = new URL(String(value || ''));
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const privateIpv4 = /^10(?:\.\d{1,3}){3}$/.test(host)
        || /^192\.168(?:\.\d{1,3}){2}$/.test(host)
        || /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(host)
        || /^(?:127|169\.254)(?:\.\d{1,3}){3}$/.test(host);
      const privateIpv6 = /^(?:fc|fd)[0-9a-f:]+$/i.test(host) || /^fe[89ab][0-9a-f:]+$/i.test(host);
      if (url.protocol !== 'http:' || (!privateIpv4 && !privateIpv6)) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function ensureStyles() {
    if (document.getElementById('restaurantQrEdgeFallbackStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantQrEdgeFallbackStyles';
    style.textContent = `
      .qrv-edge-banner{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;margin:12px 0;padding:14px 15px;border:2px solid #d89a2f;border-radius:16px;background:#fff7df;color:#50370e;box-shadow:0 8px 20px rgba(80,55,14,.08)}
      .qrv-edge-banner strong{display:block;font-size:14px}.qrv-edge-banner span{display:block;margin-top:3px;font-size:12px;line-height:1.35}
      .qrv-edge-banner button,.qrv-edge-modal button{min-height:48px;padding:0 15px;border:0;border-radius:12px;background:#181614;color:#fff;font-weight:900}
      .qrv-edge-overlay{position:fixed;inset:0;z-index:180;display:grid;place-items:end center;padding:10px;background:rgba(20,18,16,.66);backdrop-filter:blur(5px)}
      .qrv-edge-modal{width:min(580px,100%);padding:22px;border-radius:24px 24px 16px 16px;background:#fffdf8;color:#201c18;box-shadow:0 26px 70px rgba(0,0,0,.32)}
      .qrv-edge-modal h2{margin:0;font-size:28px}.qrv-edge-modal p{margin:10px 0 16px;color:#685d52;line-height:1.5}.qrv-edge-modal .qrv-edge-primary{width:100%;min-height:60px;background:#ef6f24}.qrv-edge-modal .qrv-edge-close{width:100%;margin-top:8px;background:transparent;color:#403831;border:1px solid #d9cbb9}
      @media(max-width:560px){.qrv-edge-banner{grid-template-columns:1fr}.qrv-edge-banner button{width:100%}}
      @media(min-width:640px){.qrv-edge-overlay{place-items:center}.qrv-edge-modal{border-radius:24px}}
    `;
    document.head.appendChild(style);
  }

  function goLocal() {
    const url = safeLocalUrl(localFallbackUrl);
    if (!url) return;
    location.href = url;
  }

  function renderBanner() {
    const url = safeLocalUrl(localFallbackUrl);
    if (!url || document.getElementById('restaurantQrEdgeFallbackBanner')) return;
    ensureStyles();
    const frame = document.querySelector('.qrv3-frame');
    const hero = document.querySelector('.qrv3-hero');
    if (!frame || !hero) return;
    const banner = document.createElement('div');
    banner.id = 'restaurantQrEdgeFallbackBanner';
    banner.className = 'qrv-edge-banner';
    banner.innerHTML = '<div><strong>El restaurante está trabajando en modo local</strong><span>Conéctate al Wi-Fi del restaurante para enviar tu pedido directamente a Cocina/Barra/Postres.</span></div><button type="button">CONTINUAR EN RED LOCAL</button>';
    hero.insertAdjacentElement('afterend', banner);
    banner.querySelector('button').addEventListener('click', goLocal);
  }

  function showBlockingModal() {
    const url = safeLocalUrl(localFallbackUrl);
    ensureStyles();
    document.getElementById('restaurantQrEdgeFallbackOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'restaurantQrEdgeFallbackOverlay';
    overlay.className = 'qrv-edge-overlay';
    overlay.innerHTML = `<section class="qrv-edge-modal" role="dialog" aria-modal="true"><h2>Este pedido no se envió</h2><p>${url ? 'El restaurante perdió la conexión con Internet. Conéctate a su Wi-Fi y continúa en modo local; el pedido llegará directamente al sistema interno.' : 'El restaurante perdió la conexión con Internet. Pídele al mesero que registre el pedido desde su tablet.'}</p>${url ? '<button class="qrv-edge-primary" type="button">CONTINUAR EN RED LOCAL</button>' : ''}<button class="qrv-edge-close" type="button">ENTENDIDO</button></section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.qrv-edge-primary')?.addEventListener('click', goLocal);
    overlay.querySelector('.qrv-edge-close')?.addEventListener('click', () => overlay.remove());
  }

  async function loadFallback() {
    try {
      const response = await previousFetch(`${apiPrefix}/visita`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      const candidate = safeLocalUrl(body?.data?.localFallbackUrl);
      if (candidate) {
        localFallbackUrl = candidate;
        renderBanner();
      }
    } catch {}
  }

  window.fetch = async (input, init = {}) => {
    const response = await previousFetch(input, init);
    const url = targetUrl(input);
    if (response.status === 503 && url.includes(`${apiPrefix}/pedidos`)) {
      try {
        const body = await response.clone().json();
        const code = body?.error?.code || body?.code;
        if (code === 'RESTAURANT_QR_EDGE_OFFLINE') {
          localFallbackUrl = safeLocalUrl(body?.error?.details?.localFallbackUrl || body?.details?.localFallbackUrl) || localFallbackUrl;
          if (!localFallbackUrl) await loadFallback();
          showBlockingModal();
        }
      } catch {}
    }
    return response;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => loadFallback(), { once: true });
  else loadFallback();
})();
