'use strict';

const MARKER = 'VANTIX_RESTAURANT_CASH_COLLECT_DIALOG_V39';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_CASH_COLLECT_DIALOG_V39';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({version:'39.0.0',directCollectDialog:true,noScrollDependency:true});

  const STYLE_ID='vantix-cash-collect-dialog-v39-style';
  const BACKDROP_ID='vantixCashCollectBackdropV39';
  let activeTableId=null;
  let restoreScrollY=0;

  function ensureStyle(){
    if(document.getElementById(STYLE_ID)) return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent='html.cash-collect-lock-v39,html.cash-collect-lock-v39 body{overflow:hidden!important}.cash-collect-backdrop-v39{position:fixed;inset:0;z-index:1090;background:rgba(15,23,42,.52);backdrop-filter:blur(2px)}.cash-fast-panel.cash-collect-dialog-v39{position:fixed!important;z-index:1100!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;width:min(650px,calc(100vw - 28px))!important;max-height:min(90dvh,850px)!important;overflow:auto!important;overscroll-behavior:contain!important;box-shadow:0 30px 90px rgba(15,23,42,.35)!important}.cash-collect-close-v39{appearance:none;width:38px;height:38px;min-width:38px;border:1px solid #d7dee8;border-radius:10px;background:#fff;color:#0f172a;font-size:20px;font-weight:900;cursor:pointer}.cash-fast-panel.cash-collect-dialog-v39 .cash-panel-head{position:sticky;top:0;z-index:2;background:#fff}@media(max-width:560px){.cash-fast-panel.cash-collect-dialog-v39{width:calc(100vw - 12px)!important;max-height:94dvh!important;border-radius:16px!important}.cash-fast-panel.cash-collect-dialog-v39 .cash-panel-head{min-height:58px;padding:10px 12px}}';
    document.head.appendChild(style);
  }

  function findRow(tableId){
    return [...document.querySelectorAll('[data-cash-table]')].find((row)=>row.dataset.cashTable===tableId)||null;
  }

  function cleanup(){
    document.getElementById(BACKDROP_ID)?.remove();
    const panel=document.querySelector('.cash-fast-panel.cash-collect-dialog-v39');
    if(panel){
      panel.classList.remove('cash-collect-dialog-v39');
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      panel.removeAttribute('tabindex');
      panel.querySelector('.cash-collect-close-v39')?.remove();
    }
    document.documentElement.classList.remove('cash-collect-lock-v39');
    activeTableId=null;
  }

  function closeDialog(){
    const y=restoreScrollY;
    cleanup();
    requestAnimationFrame(()=>window.scrollTo({top:y,left:0,behavior:'auto'}));
  }

  function showDialog(tableId){
    const selected=findRow(tableId);
    const panel=document.querySelector('#view .cash-fast-panel');
    if(!selected?.classList.contains('selected') || !panel?.querySelector('#closeTable')) return false;
    if(panel.classList.contains('cash-collect-dialog-v39')) return true;

    cleanup();
    ensureStyle();
    activeTableId=tableId;
    restoreScrollY=window.scrollY||document.documentElement.scrollTop||0;

    const backdrop=document.createElement('div');
    backdrop.id=BACKDROP_ID;
    backdrop.className='cash-collect-backdrop-v39';
    backdrop.addEventListener('click',closeDialog);
    document.body.appendChild(backdrop);

    const close=document.createElement('button');
    close.type='button';
    close.className='cash-collect-close-v39';
    close.setAttribute('aria-label','Cerrar cobro');
    close.textContent='×';
    close.addEventListener('click',closeDialog);
    panel.querySelector('.cash-panel-head')?.appendChild(close);

    panel.classList.add('cash-collect-dialog-v39');
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('tabindex','-1');
    document.documentElement.classList.add('cash-collect-lock-v39');
    requestAnimationFrame(()=>panel.focus({preventScroll:true}));
    return true;
  }

  function openWhenReady(tableId,attempt=0){
    if(!document.querySelector('#view .cash-shell')) return cleanup();
    if(showDialog(tableId)) return;
    const delays=[40,80,140,220,360,560,850,1250];
    if(attempt<delays.length) setTimeout(()=>openWhenReady(tableId,attempt+1),delays[attempt]);
  }

  function cleanupAfterPayment(attempt=0){
    const panel=document.querySelector('.cash-fast-panel.cash-collect-dialog-v39');
    if(!panel || !panel.isConnected || !document.querySelector('#view .cash-shell')) return cleanup();
    if(attempt<7) setTimeout(()=>cleanupAfterPayment(attempt+1),[120,220,360,520,750,1050,1500][attempt]);
  }

  document.addEventListener('click',(event)=>{
    const row=event.target?.closest?.('[data-cash-table]');
    if(row?.dataset.cashTable){
      const tableId=row.dataset.cashTable;
      setTimeout(()=>openWhenReady(tableId),0);
      return;
    }
    if(event.target?.closest?.('#closeTable')) setTimeout(()=>cleanupAfterPayment(),80);
    if(event.target?.closest?.('[data-tab]:not([data-tab="caja"]),[data-cc-tab]:not([data-cc-tab="caja"])')) cleanup();
  },true);

  window.addEventListener('popstate',cleanup);
})();
`;

function installCashCollectDialogRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n;${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Cash-Collect', 'v39-direct-dialog');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installCashCollectDialogRuntime };
