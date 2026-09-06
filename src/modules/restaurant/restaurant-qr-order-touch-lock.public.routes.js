'use strict';

const MARKER = 'VANTIX_RESTAURANT_QR_ORDER_TOUCH_LOCK_V33';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_QR_ORDER_TOUCH_LOCK_V33';
  if(window[MARKER]) return;
  window[MARKER]=true;
  let locked=false;
  let scrollY=0;
  let previousBody=null;
  let inertSnapshot=[];

  function mobile(){return window.matchMedia?.('(max-width:1099px)').matches !== false;}
  function panel(){return document.querySelector('#orderPanel');}
  function sheet(){return document.querySelector('#orderPanel:not([hidden]) .qrv3-sheet');}
  function open(){const node=panel();return Boolean(node&&!node.hidden);}
  function backgroundNodes(){return [document.querySelector('.qrv3-shell'),document.querySelector('#cartBar'),document.querySelector('#helpPanel')].filter(Boolean);}

  function lockBackground(){
    inertSnapshot=backgroundNodes().map((node)=>({node,inert:Boolean(node.inert)}));
    inertSnapshot.forEach(({node})=>{try{node.inert=true;}catch{}});
  }
  function restoreBackground(){
    inertSnapshot.forEach(({node,inert})=>{try{node.inert=inert;}catch{}});
    inertSnapshot=[];
  }
  function lock(){
    if(locked||!mobile()||!open()) return;
    const target=sheet();
    if(!target) return;
    scrollY=window.scrollY||window.pageYOffset||0;
    previousBody={position:document.body.style.position,top:document.body.style.top,left:document.body.style.left,right:document.body.style.right,width:document.body.style.width,overflow:document.body.style.overflow,htmlOverflow:document.documentElement.style.overflow};
    document.body.style.position='fixed';
    document.body.style.top=(-scrollY)+'px';
    document.body.style.left='0';
    document.body.style.right='0';
    document.body.style.width='100%';
    document.body.style.overflow='hidden';
    document.documentElement.style.overflow='hidden';
    document.body.dataset.qrOrderTouchLocked='1';
    lockBackground();
    locked=true;
    target.setAttribute('tabindex','-1');
    target.focus?.({preventScroll:true});
  }
  function unlock(){
    if(!locked) return;
    const p=previousBody||{};
    restoreBackground();
    document.body.style.position=p.position||'';
    document.body.style.top=p.top||'';
    document.body.style.left=p.left||'';
    document.body.style.right=p.right||'';
    document.body.style.width=p.width||'';
    document.body.style.overflow=p.overflow||'';
    document.documentElement.style.overflow=p.htmlOverflow||'';
    delete document.body.dataset.qrOrderTouchLocked;
    locked=false;
    previousBody=null;
    window.scrollTo(0,scrollY);
  }
  function sync(){if(open()) lock();else unlock();}

  if(!document.querySelector('#restaurantQrOrderTouchLockV33')){
    const style=document.createElement('style');
    style.id='restaurantQrOrderTouchLockV33';
    style.textContent='@media(max-width:1099px){body[data-qr-order-touch-locked="1"]{overscroll-behavior:none!important}body[data-qr-order-touch-locked="1"] .qrv3-shell,body[data-qr-order-touch-locked="1"] #cartBar,body[data-qr-order-touch-locked="1"] #helpPanel{pointer-events:none!important;user-select:none!important}#orderPanel:not([hidden]){pointer-events:auto!important;overscroll-behavior:none!important;touch-action:none!important}#orderPanel:not([hidden]) .qrv3-sheet{pointer-events:auto!important;overflow-y:auto!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch;touch-action:pan-y!important;max-height:calc(var(--qrv-visible-height,100dvh) - 8px)!important}#orderPanel:not([hidden]) .qrv3-sheet-body{min-height:0}}';
    document.head.appendChild(style);
  }

  document.addEventListener('click',()=>queueMicrotask(sync));
  document.addEventListener('touchmove',(event)=>{
    if(!locked||!open()) return;
    if(!event.target.closest?.('#orderPanel .qrv3-sheet')) event.preventDefault();
  },{passive:false,capture:true});
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape') queueMicrotask(sync);},true);
  window.addEventListener('resize',()=>requestAnimationFrame(sync),{passive:true});
  window.visualViewport?.addEventListener('resize',()=>requestAnimationFrame(sync),{passive:true});
  window.addEventListener('pagehide',unlock);
  window.addEventListener('pageshow',()=>requestAnimationFrame(sync));
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(sync),{once:true});
  else requestAnimationFrame(sync);
})();
`;

function installQrOrderTouchLock(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-qr-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-QR-Order-Touch', 'v33-owned-sheet-no-pass-through');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installQrOrderTouchLock };
