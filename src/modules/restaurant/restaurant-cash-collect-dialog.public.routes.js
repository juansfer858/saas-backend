'use strict';

const MARKER = 'VANTIX_RESTAURANT_CASH_COLLECT_DIALOG_V40';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_CASH_COLLECT_DIALOG_V40';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({version:'40.0.0',directCollectDialog:true,noScrollDependency:true,rerenderSafe:true,orphanBackdropGuard:true});

  const STYLE_ID='vantix-cash-collect-dialog-v40-style';
  const BACKDROP_ID='vantixCashCollectBackdropV40';
  const DIALOG_CLASS='cash-collect-dialog-v40';
  const CLOSE_CLASS='cash-collect-close-v40';
  let activeTableId=null;
  let restoreScrollY=0;
  let stabilityToken=0;
  let openToken=0;

  function ensureStyle(){
    if(document.getElementById(STYLE_ID)) return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent='html.cash-collect-lock-v40,html.cash-collect-lock-v40 body{overflow:hidden!important}.cash-collect-backdrop-v40{position:fixed;inset:0;z-index:1090;background:rgba(15,23,42,.52);backdrop-filter:blur(2px)}.cash-fast-panel.cash-collect-dialog-v40{position:fixed!important;z-index:1100!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;width:min(650px,calc(100vw - 28px))!important;max-height:min(90dvh,850px)!important;overflow:auto!important;overscroll-behavior:contain!important;box-shadow:0 30px 90px rgba(15,23,42,.35)!important}.cash-collect-close-v40{appearance:none;width:38px;height:38px;min-width:38px;border:1px solid #d7dee8;border-radius:10px;background:#fff;color:#0f172a;font-size:20px;font-weight:900;cursor:pointer}.cash-fast-panel.cash-collect-dialog-v40 .cash-panel-head{position:sticky;top:0;z-index:2;background:#fff}@media(max-width:560px){.cash-fast-panel.cash-collect-dialog-v40{width:calc(100vw - 12px)!important;max-height:94dvh!important;border-radius:16px!important}.cash-fast-panel.cash-collect-dialog-v40 .cash-panel-head{min-height:58px;padding:10px 12px}}';
    document.head.appendChild(style);
  }

  function findRow(tableId){
    return [...document.querySelectorAll('[data-cash-table]')].find((row)=>row.dataset.cashTable===tableId)||null;
  }

  function clearPanel(panel){
    if(!panel) return;
    panel.classList.remove(DIALOG_CLASS);
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    panel.removeAttribute('tabindex');
    panel.querySelectorAll('.'+CLOSE_CLASS).forEach((node)=>node.remove());
  }

  function cleanup({cancelOpen=true}={}){
    stabilityToken+=1;
    if(cancelOpen) openToken+=1;
    document.getElementById(BACKDROP_ID)?.remove();
    document.querySelectorAll('.cash-fast-panel.'+DIALOG_CLASS).forEach(clearPanel);
    document.documentElement.classList.remove('cash-collect-lock-v40');
    activeTableId=null;
  }

  function closeDialog(){
    const y=restoreScrollY;
    cleanup();
    requestAnimationFrame(()=>window.scrollTo({top:y,left:0,behavior:'auto'}));
  }

  function ensureBackdrop(){
    let backdrop=document.getElementById(BACKDROP_ID);
    if(backdrop) return backdrop;
    backdrop=document.createElement('div');
    backdrop.id=BACKDROP_ID;
    backdrop.className='cash-collect-backdrop-v40';
    backdrop.addEventListener('click',closeDialog);
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function decoratePanel(panel){
    document.querySelectorAll('.cash-fast-panel.'+DIALOG_CLASS).forEach((current)=>{ if(current!==panel) clearPanel(current); });
    panel.querySelectorAll('.'+CLOSE_CLASS).forEach((node)=>node.remove());

    const close=document.createElement('button');
    close.type='button';
    close.className=CLOSE_CLASS;
    close.setAttribute('aria-label','Cerrar cobro');
    close.textContent='×';
    close.addEventListener('click',closeDialog);
    panel.querySelector('.cash-panel-head')?.appendChild(close);

    panel.classList.add(DIALOG_CLASS);
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('tabindex','-1');
    document.documentElement.classList.add('cash-collect-lock-v40');
    requestAnimationFrame(()=>{ if(panel.isConnected) panel.focus({preventScroll:true}); });
  }

  function bindCurrentPanel(tableId){
    const selected=findRow(tableId);
    const panel=document.querySelector('#view .cash-fast-panel');
    if(!selected?.classList.contains('selected') || !panel?.querySelector('#closeTable')) return false;
    ensureStyle();
    ensureBackdrop();
    decoratePanel(panel);
    return true;
  }

  function stabilizeDialog(tableId,token,attempt=0){
    if(token!==stabilityToken || activeTableId!==tableId) return;
    const shell=document.querySelector('#view .cash-shell');
    if(!shell){ cleanup(); return; }

    const panel=document.querySelector('#view .cash-fast-panel');
    const selected=findRow(tableId);
    const ready=Boolean(selected?.classList.contains('selected') && panel?.querySelector('#closeTable'));
    if(ready){
      if(!document.getElementById(BACKDROP_ID) || !panel.classList.contains(DIALOG_CLASS)){
        ensureBackdrop();
        decoratePanel(panel);
      }
    }else if(attempt>=9){
      cleanup();
      return;
    }

    const delays=[30,55,90,140,210,320,480,700,1000,1400];
    if(attempt<delays.length) setTimeout(()=>stabilizeDialog(tableId,token,attempt+1),delays[attempt]);
  }

  function openWhenReady(tableId,token,attempt=0){
    if(token!==openToken) return;
    if(!document.querySelector('#view .cash-shell')){ cleanup({cancelOpen:false}); return; }
    if(bindCurrentPanel(tableId)){
      activeTableId=tableId;
      const stable=++stabilityToken;
      stabilizeDialog(tableId,stable,0);
      return;
    }
    const delays=[25,45,75,115,170,250,360,520,760,1100,1500];
    if(attempt<delays.length) setTimeout(()=>openWhenReady(tableId,token,attempt+1),delays[attempt]);
    else cleanup({cancelOpen:false});
  }

  function beginOpen(tableId){
    const token=++openToken;
    const same=activeTableId===tableId;
    if(!same){
      cleanup({cancelOpen:false});
      restoreScrollY=window.scrollY||document.documentElement.scrollTop||0;
    }
    activeTableId=tableId;
    setTimeout(()=>openWhenReady(tableId,token,0),0);
  }

  function cleanupAfterPayment(attempt=0){
    const panel=document.querySelector('.cash-fast-panel.'+DIALOG_CLASS);
    if(!panel || !panel.isConnected || !document.querySelector('#view .cash-shell')) return cleanup();
    if(attempt<7) setTimeout(()=>cleanupAfterPayment(attempt+1),[120,220,360,520,750,1050,1500][attempt]);
  }

  document.addEventListener('click',(event)=>{
    const row=event.target?.closest?.('[data-cash-table]');
    if(row?.dataset.cashTable){
      beginOpen(row.dataset.cashTable);
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
    res.set('X-VantixGC-Cash-Collect', 'v40-rerender-safe-dialog');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installCashCollectDialogRuntime };
