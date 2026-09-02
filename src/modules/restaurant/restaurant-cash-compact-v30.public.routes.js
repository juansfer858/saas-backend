'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const restaurantCashCompactV30PublicRouter = express.Router();
const restaurantUiPath = path.join(__dirname, '..', '..', 'web', 'restaurant-ui.js');
const restaurantControlCenterCssPath = path.join(__dirname, '..', '..', 'web', 'restaurant-control-center.css');

const UI_MARKER = 'VANTIX_CASH_COMPACT_V30';
const CSS_MARKER = 'VANTIX_CASH_COMPACT_V30_CSS';

const compactCashRuntime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_CASH_COMPACT_V30';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({version:'30.1.0',presentationOnly:true,dialogs:true,eventDriven:true});

  const DIALOG_SELECTOR='dialog.cash-compact-dialog-v30';

  function closeDialog(dialog){
    if(!dialog) return;
    if(typeof dialog.close==='function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function openDialog(dialog){
    if(!dialog) return;
    if(typeof dialog.showModal==='function') dialog.showModal();
    else dialog.setAttribute('open','');
  }

  function clearDialogs(){
    document.querySelectorAll(DIALOG_SELECTOR).forEach((dialog)=>dialog.remove());
  }

  function buildDialog(kind,title,subtitle,panel){
    const dialog=document.createElement('dialog');
    dialog.className='cash-compact-dialog-v30 cash-compact-dialog-'+kind+'-v30';
    dialog.setAttribute('aria-label',title);

    const head=document.createElement('div');
    head.className='cash-compact-dialog-head-v30';
    head.innerHTML='<div><strong>'+title+'</strong><small>'+subtitle+'</small></div><button type="button" class="cash-compact-close-v30" aria-label="Cerrar">×</button>';

    const body=document.createElement('div');
    body.className='cash-compact-dialog-body-v30';
    body.appendChild(panel);

    dialog.append(head,body);
    document.body.appendChild(dialog);

    head.querySelector('.cash-compact-close-v30').addEventListener('click',()=>closeDialog(dialog));
    dialog.addEventListener('click',(event)=>{
      if(event.target===dialog) closeDialog(dialog);
    });
    dialog.addEventListener('cancel',(event)=>{
      event.preventDefault();
      closeDialog(dialog);
    });
    return dialog;
  }

  function enhanceCash(){
    const shell=document.querySelector('#view .cash-shell');
    if(!shell){
      clearDialogs();
      return;
    }
    if(shell.querySelector('.cash-compact-tools-v30')) return;

    const lower=shell.querySelector('.cash-lower-grid');
    if(!lower) return;
    const recent=lower.querySelector('.cash-recent-list')?.closest('.cash-panel');
    const summary=lower.querySelector('.cash-close-panel');
    if(!recent || !summary) return;

    clearDialogs();
    const recentCount=recent.querySelectorAll('.cash-recent-row').length;
    const recentDialog=buildDialog('recent','Últimos cobros','Historial del turno actual',recent);
    const summaryDialog=buildDialog('summary','Resumen del turno','Arqueo, diferencia y cierre',summary);

    const tools=document.createElement('section');
    tools.className='cash-compact-tools-v30';
    tools.setAttribute('aria-label','Detalle y cierre del turno');
    tools.innerHTML=
      '<button type="button" class="cash-compact-tool-v30 cash-compact-recent-v30">'+
        '<span class="cash-compact-icon-v30" aria-hidden="true">↺</span>'+
        '<span class="cash-compact-copy-v30"><b>Últimos cobros <em>'+recentCount+'</em></b><small>Historial del turno</small></span>'+
        '<span class="cash-compact-arrow-v30" aria-hidden="true">›</span>'+
      '</button>'+
      '<button type="button" class="cash-compact-tool-v30 cash-compact-summary-v30">'+
        '<span class="cash-compact-icon-v30" aria-hidden="true">▤</span>'+
        '<span class="cash-compact-copy-v30"><b>Resumen del turno</b><small>Arqueo y cierre de caja</small></span>'+
        '<span class="cash-compact-arrow-v30" aria-hidden="true">›</span>'+
      '</button>';

    tools.querySelector('.cash-compact-recent-v30').addEventListener('click',()=>openDialog(recentDialog));
    tools.querySelector('.cash-compact-summary-v30').addEventListener('click',()=>openDialog(summaryDialog));
    lower.replaceWith(tools);
  }

  let queued=false;
  let burstToken=0;
  function schedule(){
    if(queued) return;
    queued=true;
    queueMicrotask(()=>{
      queued=false;
      enhanceCash();
    });
  }

  // No polling and no DOM observer: a short finite burst follows actual UI/realtime events.
  // This preserves V23's push-driven contract while still catching async Caja renders.
  function scheduleBurst(){
    const token=++burstToken;
    [0,90,220,500,1000,1800,3200].forEach((delay)=>{
      setTimeout(()=>{
        if(token!==burstToken) return;
        schedule();
      },delay);
    });
  }

  document.addEventListener('click',(event)=>{
    const target=event.target.closest?.('[data-tab="caja"],[data-cc-tab="caja"],.cash-shell button,.cash-shell summary,.cash-compact-dialog-v30 button');
    if(target) scheduleBurst();
  },true);
  window.addEventListener('vantix:tenant-realtime',scheduleBurst);
  window.addEventListener('vantix:tenant-realtime-ready',scheduleBurst);
  window.addEventListener('popstate',scheduleBurst);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',scheduleBurst,{once:true});
  else scheduleBurst();
})();
`;

const compactCashCss = String.raw`
/* VANTIX_CASH_COMPACT_V30_CSS — Caja keeps operational actions in-place, hidden behind compact dialogs. */
.cash-compact-tools-v30{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:10px;
  margin-top:2px;
}
.cash-compact-tool-v30{
  appearance:none;
  width:100%;
  min-height:68px;
  border:1px solid #d7e1ec;
  border-radius:15px;
  background:#fff;
  color:#0d1b34;
  display:grid;
  grid-template-columns:42px minmax(0,1fr) 22px;
  gap:10px;
  align-items:center;
  padding:10px 12px;
  text-align:left;
  box-shadow:0 7px 18px rgba(13,27,52,.05);
  transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease;
}
.cash-compact-tool-v30:hover{
  transform:translateY(-1px);
  border-color:#bfcddd;
  box-shadow:0 10px 22px rgba(13,27,52,.08);
}
.cash-compact-icon-v30{
  width:42px;
  height:42px;
  border-radius:13px;
  display:grid;
  place-items:center;
  font-size:18px;
  font-weight:950;
}
.cash-compact-recent-v30 .cash-compact-icon-v30{background:#ddf4f1;color:#10867f}
.cash-compact-summary-v30 .cash-compact-icon-v30{background:#ffe6da;color:#ff6b2c}
.cash-compact-copy-v30{display:grid;gap:3px;min-width:0}
.cash-compact-copy-v30 b{font-size:13px;font-weight:950;color:#0d1b34}
.cash-compact-copy-v30 b em{
  display:inline-grid;
  place-items:center;
  min-width:22px;
  height:22px;
  margin-left:5px;
  padding:0 6px;
  border-radius:999px;
  background:#e5efff;
  color:#3f77c7;
  font-style:normal;
  font-size:10px;
}
.cash-compact-copy-v30 small{font-size:10px;color:#637997;font-weight:700}
.cash-compact-arrow-v30{font-size:25px;color:#94a3b8;text-align:right;line-height:1}

.cash-compact-dialog-v30{
  width:min(760px,calc(100vw - 28px));
  max-width:760px;
  max-height:min(88dvh,820px);
  border:1px solid #d7e1ec;
  border-radius:20px;
  padding:0;
  overflow:hidden;
  background:#fff;
  color:#0d1b34;
  box-shadow:0 30px 80px rgba(13,27,52,.28);
}
.cash-compact-dialog-v30::backdrop{background:rgba(18,43,74,.48);backdrop-filter:blur(2px)}
.cash-compact-dialog-head-v30{
  min-height:64px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  padding:12px 14px;
  border-bottom:1px solid #d7e1ec;
  background:#f5f8fc;
}
.cash-compact-dialog-head-v30 > div{display:grid;gap:3px}
.cash-compact-dialog-head-v30 strong{font-size:16px;font-weight:950;color:#122b4a}
.cash-compact-dialog-head-v30 small{font-size:10px;color:#637997;font-weight:700}
.cash-compact-close-v30{
  appearance:none;
  width:42px;
  min-width:42px;
  height:42px;
  border:1px solid #d7e1ec;
  border-radius:12px;
  background:#fff;
  color:#122b4a;
  font-size:22px;
  font-weight:900;
}
.cash-compact-dialog-body-v30{
  max-height:calc(min(88dvh,820px) - 64px);
  overflow:auto;
  padding:14px;
  overscroll-behavior:contain;
}
.cash-compact-dialog-body-v30 .cash-panel{
  border:0!important;
  box-shadow:none!important;
  padding:0!important;
  margin:0!important;
  background:transparent!important;
}
.cash-compact-dialog-body-v30 .cash-panel-head{display:none!important}
.cash-compact-dialog-body-v30 .cash-close-button{margin-bottom:2px!important}
.cash-compact-summary-v30{border-color:#ffd3bf}

@media (max-width:699px){
  .cash-compact-tools-v30{grid-template-columns:1fr;gap:8px}
  .cash-compact-tool-v30{min-height:62px;padding:9px 10px}
  .cash-compact-dialog-v30{width:calc(100vw - 12px);max-height:90dvh;border-radius:18px}
  .cash-compact-dialog-body-v30{max-height:calc(90dvh - 62px);padding:11px}
}
`;

function patchOnce(source, marker, patch) {
  return source.includes(marker) ? source : `${source}\n${patch}\n`;
}

restaurantCashCompactV30PublicRouter.get('/app/restaurant-ui.js', async (_req, res, next) => {
  try {
    const source = await fs.promises.readFile(restaurantUiPath, 'utf8');
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Cash-Compact', 'v30-dialogs');
    res.type('application/javascript').send(patchOnce(source, UI_MARKER, compactCashRuntime));
  } catch (error) {
    next(error);
  }
});

restaurantCashCompactV30PublicRouter.get('/app/restaurant-control-center.css', async (_req, res, next) => {
  try {
    const source = await fs.promises.readFile(restaurantControlCenterCssPath, 'utf8');
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Cash-Compact', 'v30-dialogs');
    res.type('text/css').send(patchOnce(source, CSS_MARKER, compactCashCss));
  } catch (error) {
    next(error);
  }
});

module.exports = {
  restaurantCashCompactV30PublicRouter,
  patchOnce,
  compactCashRuntime,
  compactCashCss
};
