'use strict';

const MARKER = 'VANTIX_RESTAURANT_QR_ORDER_SCROLL_LOCK_V31';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_QR_ORDER_SCROLL_LOCK_V31';
  if(window[MARKER]) return;
  window[MARKER]=true;
  let locked=false;
  let scrollY=0;
  let previous=null;

  function mobileDrawer(){
    return window.matchMedia?.('(max-width:1099px)').matches !== false;
  }
  function panel(){ return document.querySelector('#orderPanel,.qrv3-order-panel,.qr-order-panel'); }
  function lock(){
    if(locked||!mobileDrawer()||!document.body.classList.contains('order-open')) return;
    const target=panel();
    if(!target) return;
    scrollY=window.scrollY||window.pageYOffset||0;
    previous={position:document.body.style.position,top:document.body.style.top,left:document.body.style.left,right:document.body.style.right,width:document.body.style.width,overflow:document.body.style.overflow,htmlOverflow:document.documentElement.style.overflow};
    document.body.style.position='fixed';
    document.body.style.top=(-scrollY)+'px';
    document.body.style.left='0';
    document.body.style.right='0';
    document.body.style.width='100%';
    document.body.style.overflow='hidden';
    document.documentElement.style.overflow='hidden';
    document.body.dataset.qrOrderScrollLocked='1';
    locked=true;
    target.focus?.({preventScroll:true});
  }
  function unlock(){
    if(!locked) return;
    const p=previous||{};
    document.body.style.position=p.position||'';
    document.body.style.top=p.top||'';
    document.body.style.left=p.left||'';
    document.body.style.right=p.right||'';
    document.body.style.width=p.width||'';
    document.body.style.overflow=p.overflow||'';
    document.documentElement.style.overflow=p.htmlOverflow||'';
    delete document.body.dataset.qrOrderScrollLocked;
    locked=false;
    previous=null;
    window.scrollTo(0,scrollY);
  }
  function sync(){
    if(document.body.classList.contains('order-open')) lock();
    else unlock();
  }

  if(!document.querySelector('#restaurantQrOrderScrollLockV31')){
    const style=document.createElement('style');
    style.id='restaurantQrOrderScrollLockV31';
    style.textContent='@media(max-width:1099px){body.order-open{overscroll-behavior:none}.order-open .qr-order-panel,.order-open .qrv3-order-panel,#orderPanel{overflow-y:auto!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch;touch-action:pan-y;max-height:calc(var(--qrv-visible-height,100dvh) - 8px)!important}.order-open .qr-backdrop,.order-open .qrv3-backdrop{touch-action:none;overscroll-behavior:none}}';
    document.head.appendChild(style);
  }

  document.addEventListener('click',()=>requestAnimationFrame(sync),true);
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape') requestAnimationFrame(sync);},true);
  window.addEventListener('resize',()=>requestAnimationFrame(sync),{passive:true});
  window.addEventListener('pagehide',unlock);
  window.addEventListener('pageshow',()=>requestAnimationFrame(sync));
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(sync),{once:true});
  else requestAnimationFrame(sync);
})();
`;

function installQrOrderScrollLock(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-qr-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-QR-Order-Scroll', 'v31-owned-drawer-scroll');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installQrOrderScrollLock };
