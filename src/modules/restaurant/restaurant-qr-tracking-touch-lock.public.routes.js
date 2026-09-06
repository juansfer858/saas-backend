'use strict';

const MARKER = 'VANTIX_QR_TRACKING_TOUCH_LOCK_V35';

const helperBlock = `
  const ${MARKER} = { locked:false, scrollY:0, previous:null, inert:[], touchStartY:0 };

  function ensureTrackingTouchStyles() {
    if (document.getElementById('restaurantQrTrackingTouchV35Styles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantQrTrackingTouchV35Styles';
    style.textContent = '@media(max-width:1099px){body[data-qrv-tracking-touch-locked="1"]{overscroll-behavior:none!important}body[data-qrv-tracking-touch-locked="1"] .qrv3-shell,body[data-qrv-tracking-touch-locked="1"] #cartBar,body[data-qrv-tracking-touch-locked="1"] #helpPanel,body[data-qrv-tracking-touch-locked="1"] #orderPanel,body[data-qrv-tracking-touch-locked="1"] #restaurantOrderTrackingButton{pointer-events:none!important;user-select:none!important}#restaurantOrderTrackingPanel:not([hidden]){pointer-events:auto!important;touch-action:none!important;overscroll-behavior:none!important}#restaurantOrderTrackingPanel:not([hidden]) .qrv3-sheet{display:flex!important;flex-direction:column!important;overflow:hidden!important;max-height:calc(var(--qrv-visible-height,100dvh) - 8px)!important}#restaurantOrderTrackingPanel:not([hidden]) .qrv3-sheet-head{flex:0 0 auto}#restaurantOrderTrackingPanel:not([hidden]) #restaurantOrderTrackingBody{flex:1 1 auto;min-height:0;overflow-y:auto!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch;touch-action:pan-y!important}}';
    document.head.appendChild(style);
  }

  function trackingBackgroundNodes() {
    return [
      document.querySelector('.qrv3-shell'),
      document.getElementById('cartBar'),
      document.getElementById('helpPanel'),
      document.getElementById('orderPanel'),
      document.getElementById('restaurantOrderTrackingButton')
    ].filter(Boolean);
  }

  function trackingTouchStart(event) {
    if (!${MARKER}.locked) return;
    ${MARKER}.touchStartY = Number(event.touches?.[0]?.clientY || 0);
  }

  function trackingTouchMove(event) {
    if (!${MARKER}.locked) return;
    const scroller = event.target.closest?.('#restaurantOrderTrackingBody');
    if (!scroller) {
      event.preventDefault();
      return;
    }
    const currentY = Number(event.touches?.[0]?.clientY || 0);
    const delta = currentY - ${MARKER}.touchStartY;
    const atTop = scroller.scrollTop <= 0;
    const atBottom = Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight;
    if ((atTop && delta > 0) || (atBottom && delta < 0)) event.preventDefault();
  }

  function lockTrackingTouch(panel) {
    if (${MARKER}.locked || !window.matchMedia?.('(max-width:1099px)').matches) return;
    ensureTrackingTouchStyles();
    ${MARKER}.scrollY = window.scrollY || window.pageYOffset || 0;
    ${MARKER}.previous = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow
    };
    ${MARKER}.inert = trackingBackgroundNodes().map((node) => ({ node, inert:Boolean(node.inert) }));
    ${MARKER}.inert.forEach(({node}) => { try { node.inert = true; } catch {} });
    document.body.style.position = 'fixed';
    document.body.style.top = \`-\${${MARKER}.scrollY}px\`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.dataset.qrvTrackingTouchLocked = '1';
    ${MARKER}.locked = true;
    if (!panel.dataset.qrvTrackingTouchBound) {
      panel.dataset.qrvTrackingTouchBound = '1';
      panel.addEventListener('touchstart', trackingTouchStart, { passive:true, capture:true });
      panel.addEventListener('touchmove', trackingTouchMove, { passive:false, capture:true });
    }
  }

  function unlockTrackingTouch() {
    if (!${MARKER}.locked) return;
    const previous = ${MARKER}.previous || {};
    const restoreY = ${MARKER}.scrollY;
    ${MARKER}.inert.forEach(({node,inert}) => { try { node.inert = inert; } catch {} });
    ${MARKER}.inert = [];
    document.body.style.position = previous.position || '';
    document.body.style.top = previous.top || '';
    document.body.style.left = previous.left || '';
    document.body.style.right = previous.right || '';
    document.body.style.width = previous.width || '';
    document.body.style.overflow = previous.overflow || '';
    document.documentElement.style.overflow = previous.htmlOverflow || '';
    delete document.body.dataset.qrvTrackingTouchLocked;
    ${MARKER}.locked = false;
    ${MARKER}.previous = null;
    window.scrollTo(0, restoreY);
  }
`;

const openNeedle = `  function openTrackingPanel() {
    ensureUi();
    renderTrackingPanel();
    const panel = document.getElementById('restaurantOrderTrackingPanel');
    if (!panel) return;
    panel.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeTrackingPanel() {
    const panel = document.getElementById('restaurantOrderTrackingPanel');
    if (!panel) return;
    panel.hidden = true;
    if (document.getElementById('helpPanel')?.hidden !== false && document.getElementById('orderPanel')?.hidden !== false) document.body.style.overflow = '';
  }
`;

const openReplacement = `${helperBlock}
  function openTrackingPanel() {
    ensureUi();
    renderTrackingPanel();
    const panel = document.getElementById('restaurantOrderTrackingPanel');
    if (!panel) return;
    lockTrackingTouch(panel);
    panel.hidden = false;
    panel.querySelector('[data-close-tracking]')?.focus({ preventScroll:true });
  }

  function closeTrackingPanel() {
    const panel = document.getElementById('restaurantOrderTrackingPanel');
    if (!panel) return;
    panel.hidden = true;
    unlockTrackingTouch();
  }
`;

function patchQrTrackingTouchLock(source) {
  const input = String(source || '');
  if (!input || input.includes(MARKER)) return input;
  if (!input.includes(openNeedle)) throw new Error('RESTAURANT_QR_TRACKING_TOUCH_TARGET_NOT_FOUND');
  return input.replace(openNeedle, openReplacement);
}

function installQrTrackingTouchLock(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-qr-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const patched = patchQrTrackingTouchLock(source);
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      res.set('X-VantixGC-QR-Tracking-Touch', 'v35-owned-tracking-body');
    }
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, patchQrTrackingTouchLock, installQrTrackingTouchLock };
