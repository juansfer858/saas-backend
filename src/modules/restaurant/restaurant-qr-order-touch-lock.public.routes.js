'use strict';

const MARKER = 'VANTIX_RESTAURANT_QR_ORDER_TOUCH_LOCK_V34';

const OPEN_CLOSE_NEEDLE = `  function openPanel(selector) {
    const panel = $(selector);
    if (!panel) return;
    panel.hidden = false;
    document.body.style.overflow = 'hidden';
    panel.querySelector('button')?.focus();
  }

  function closePanel(selector) {
    const panel = $(selector);
    if (!panel) return;
    panel.hidden = true;
    if ($('#helpPanel')?.hidden && $('#orderPanel')?.hidden) document.body.style.overflow = '';
  }`;

const OPEN_CLOSE_REPLACEMENT = `  const QR_ORDER_TOUCH_LOCK_V34 = { locked:false, scrollY:0, previous:null, inert:[] };

  function qrOrderBackgroundNodes() {
    return [document.querySelector('.qrv3-shell'), document.querySelector('#cartBar'), document.querySelector('#helpPanel')].filter(Boolean);
  }

  function lockOrderPanelTouch(panel) {
    if (!panel || panel.id !== 'orderPanel' || QR_ORDER_TOUCH_LOCK_V34.locked) return;
    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    QR_ORDER_TOUCH_LOCK_V34.scrollY = scrollY;
    QR_ORDER_TOUCH_LOCK_V34.previous = {
      position:body.style.position,
      top:body.style.top,
      left:body.style.left,
      right:body.style.right,
      width:body.style.width,
      overflow:body.style.overflow,
      htmlOverflow:html.style.overflow
    };
    QR_ORDER_TOUCH_LOCK_V34.inert = qrOrderBackgroundNodes().map((node) => ({ node, inert:Boolean(node.inert) }));
    QR_ORDER_TOUCH_LOCK_V34.inert.forEach(({ node }) => { try { node.inert = true; } catch {} });
    body.style.position = 'fixed';
    body.style.top = (-scrollY) + 'px';
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    body.dataset.qrOrderTouchLocked = '1';
    QR_ORDER_TOUCH_LOCK_V34.locked = true;
  }

  function unlockOrderPanelTouch() {
    if (!QR_ORDER_TOUCH_LOCK_V34.locked) return;
    const body = document.body;
    const html = document.documentElement;
    const previous = QR_ORDER_TOUCH_LOCK_V34.previous || {};
    QR_ORDER_TOUCH_LOCK_V34.inert.forEach(({ node, inert }) => { try { node.inert = inert; } catch {} });
    QR_ORDER_TOUCH_LOCK_V34.inert = [];
    body.style.position = previous.position || '';
    body.style.top = previous.top || '';
    body.style.left = previous.left || '';
    body.style.right = previous.right || '';
    body.style.width = previous.width || '';
    body.style.overflow = previous.overflow || '';
    html.style.overflow = previous.htmlOverflow || '';
    delete body.dataset.qrOrderTouchLocked;
    const restoreY = QR_ORDER_TOUCH_LOCK_V34.scrollY;
    QR_ORDER_TOUCH_LOCK_V34.locked = false;
    QR_ORDER_TOUCH_LOCK_V34.previous = null;
    window.scrollTo(0, restoreY);
  }

  function openPanel(selector) {
    const panel = $(selector);
    if (!panel) return;
    const isOrderPanel = selector === '#orderPanel';
    if (isOrderPanel) lockOrderPanelTouch(panel);
    panel.hidden = false;
    if (!isOrderPanel) document.body.style.overflow = 'hidden';
    const focusTarget = panel.querySelector('button');
    try { focusTarget?.focus({ preventScroll:true }); } catch { focusTarget?.focus(); }
  }

  function closePanel(selector) {
    const panel = $(selector);
    if (!panel) return;
    panel.hidden = true;
    if (selector === '#orderPanel') unlockOrderPanelTouch();
    else if ($('#helpPanel')?.hidden && $('#orderPanel')?.hidden) document.body.style.overflow = '';
  }`;

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_QR_ORDER_TOUCH_LOCK_V34';
  if(window[MARKER]) return;
  window[MARKER]=true;
  let lastTouchY=null;

  if(!document.querySelector('#restaurantQrOrderTouchLockV34')){
    const style=document.createElement('style');
    style.id='restaurantQrOrderTouchLockV34';
    style.textContent='@media(max-width:1099px){body[data-qr-order-touch-locked="1"]{overscroll-behavior:none!important}body[data-qr-order-touch-locked="1"] .qrv3-shell,body[data-qr-order-touch-locked="1"] #cartBar,body[data-qr-order-touch-locked="1"] #helpPanel{pointer-events:none!important;user-select:none!important}#orderPanel:not([hidden]){pointer-events:auto!important;overscroll-behavior:none!important;touch-action:none!important}#orderPanel:not([hidden]) .qrv3-sheet{display:flex!important;flex-direction:column!important;overflow:hidden!important;overscroll-behavior:none!important;touch-action:none!important;max-height:calc(var(--qrv-visible-height,100dvh) - 8px)!important}#orderPanel:not([hidden]) .qrv3-sheet-head{flex:0 0 auto!important}#orderPanel:not([hidden]) #orderPanelBody{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch;touch-action:pan-y!important}}';
    document.head.appendChild(style);
  }

  document.addEventListener('touchstart',(event)=>{
    if(document.body.dataset.qrOrderTouchLocked!=='1') return;
    lastTouchY=event.touches?.[0]?.clientY??null;
  },{passive:true,capture:true});

  document.addEventListener('touchmove',(event)=>{
    if(document.body.dataset.qrOrderTouchLocked!=='1') return;
    const scroller=event.target.closest?.('#orderPanelBody');
    if(!scroller){event.preventDefault();return;}
    const currentY=event.touches?.[0]?.clientY;
    if(currentY==null||lastTouchY==null){lastTouchY=currentY??null;return;}
    const delta=currentY-lastTouchY;
    lastTouchY=currentY;
    const canScroll=scroller.scrollHeight>scroller.clientHeight+1;
    const atTop=scroller.scrollTop<=0;
    const atBottom=Math.ceil(scroller.scrollTop+scroller.clientHeight)>=scroller.scrollHeight;
    if(!canScroll||(atTop&&delta>0)||(atBottom&&delta<0)) event.preventDefault();
  },{passive:false,capture:true});

  document.addEventListener('touchend',()=>{lastTouchY=null;},{passive:true,capture:true});
  document.addEventListener('touchcancel',()=>{lastTouchY=null;},{passive:true,capture:true});
})();
`;

function patchQrOrderTouchLock(source) {
  const text = String(source || '');
  if (!text || text.includes(MARKER)) return text;
  if (!text.includes(OPEN_CLOSE_NEEDLE)) throw new Error('RESTAURANT_QR_ORDER_PANEL_OPEN_CLOSE_TARGET_NOT_FOUND');
  return `${text.replace(OPEN_CLOSE_NEEDLE, OPEN_CLOSE_REPLACEMENT)}\n${runtime}\n`;
}

function installQrOrderTouchLock(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-qr-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const patched = patchQrOrderTouchLock(source);
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-QR-Order-Touch', 'v34-synchronous-owned-body-scroll');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, patchQrOrderTouchLock, installQrOrderTouchLock };
