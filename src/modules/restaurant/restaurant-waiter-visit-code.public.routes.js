'use strict';

const WAITER_VISIT_CODE_MARKER = 'VANTIX_WAITER_VISIT_CODE_V27';

const waiterVisitCodeRuntime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_WAITER_VISIT_CODE_V27';
  if(window[MARKER]) return;
  const SESSION_KEY='vantixgc_core_session_v1';
  let requestSeq=0;
  let burstToken=0;

  function session(){
    try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null');}catch{return null;}
  }
  function esc(value){
    return String(value??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }
  function selectedTableId(){
    return document.querySelector('[data-waiter-table].selected')?.dataset.waiterTable||null;
  }
  function removeCard(){
    document.querySelector('#waiterVisitCodeV27')?.remove();
  }
  function ensureStyles(){
    if(document.querySelector('#waiterVisitCodeStylesV27')) return;
    const style=document.createElement('style');
    style.id='waiterVisitCodeStylesV27';
    style.textContent='.waiter-visit-code-v27{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;margin:10px 0 14px;padding:13px 15px;border:1px solid #b8d7c7;border-radius:15px;background:#eef8f2;color:#173f31}.waiter-visit-code-v27 small{display:block;font-size:10px;font-weight:950;letter-spacing:.08em;color:#166534}.waiter-visit-code-v27 strong{display:block;margin-top:3px;font-size:30px;letter-spacing:.2em;font-variant-numeric:tabular-nums}.waiter-visit-code-v27 span{display:block;margin-top:3px;font-size:11px;line-height:1.35;color:#47675a}.waiter-visit-code-v27 button{min-height:46px;white-space:nowrap}@media(max-width:640px){.waiter-visit-code-v27{grid-template-columns:1fr}.waiter-visit-code-v27 button{width:100%}}';
    document.head.appendChild(style);
  }
  function ensureCard(tableId){
    const top=document.querySelector('.waiter-top-card');
    if(!top||selectedTableId()!==tableId) return null;
    let card=document.querySelector('#waiterVisitCodeV27');
    if(card&&card.dataset.tableId!==tableId){card.remove();card=null;}
    if(!card){
      card=document.createElement('section');
      card.id='waiterVisitCodeV27';
      card.className='waiter-visit-code-v27';
      card.dataset.tableId=tableId;
      top.insertAdjacentElement('afterend',card);
    }
    return card;
  }
  function renderStatus(tableId,status){
    const card=ensureCard(tableId);
    if(!card) return false;
    card.dataset.loaded='1';
    if(!status?.open){
      card.innerHTML='<div><small>AUTOPEDIDO QR</small><b>Mesa cerrada</b><span>El código aparecerá automáticamente cuando abras la mesa.</span></div>';
      return true;
    }
    const code=String(status.visitCode||'').replace(/[^0-9]/g,'').slice(0,4);
    card.innerHTML='<div><small>CÓDIGO PARA ACTIVAR AUTOPEDIDO</small><strong>'+esc(code)+'</strong><span>Dile estos 4 números a las personas de '+esc(status.table?.name||'la mesa')+'. '+Number(status.activeDevices||0)+' teléfono(s) autorizado(s).</span></div><button type="button" class="ri-btn" data-waiter-visit-rotate>CAMBIAR CÓDIGO</button>';
    card.querySelector('[data-waiter-visit-rotate]')?.addEventListener('click',rotateCode);
    return true;
  }
  function renderError(tableId,text){
    const card=ensureCard(tableId);
    if(!card) return false;
    card.dataset.loaded='1';
    card.innerHTML='<div><small>AUTOPEDIDO QR</small><b>Código no disponible</b><span>'+esc(text||'No fue posible consultar el código.')+'</span></div>';
    return true;
  }
  async function refreshCode(force=false){
    const tableId=selectedTableId();
    const top=document.querySelector('.waiter-top-card');
    if(!tableId||!top){removeCard();return false;}
    const existing=document.querySelector('#waiterVisitCodeV27');
    if(!force&&existing?.dataset.tableId===tableId&&existing.dataset.loaded==='1') return true;
    const s=session();
    if(!s?.token||!s?.subdomain) return false;
    const seq=++requestSeq;
    const card=ensureCard(tableId);
    if(card){card.dataset.loaded='0';card.innerHTML='<div><small>AUTOPEDIDO QR</small><b>Consultando código…</b><span>Este código vincula los teléfonos que escanearon el QR con la mesa abierta.</span></div>';}
    try{
      const response=await fetch('/api/v1/restaurante/mesas/'+encodeURIComponent(tableId)+'/qr-visita',{cache:'no-store',headers:{Authorization:'Bearer '+s.token,'x-tenant-subdomain':s.subdomain}});
      let body={};try{body=await response.json();}catch{}
      if(seq!==requestSeq||selectedTableId()!==tableId) return false;
      if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
      return renderStatus(tableId,body?.data||{});
    }catch(error){
      if(seq===requestSeq&&selectedTableId()===tableId) renderError(tableId,error.message);
      return false;
    }
  }
  async function rotateCode(event){
    const button=event.currentTarget;
    const tableId=button?.closest('#waiterVisitCodeV27')?.dataset.tableId||selectedTableId();
    const s=session();
    if(!tableId||!s?.token||!s?.subdomain) return;
    if(!confirm('¿Cambiar el código de autopedido? Los teléfonos ya autorizados tendrán que ingresar el nuevo código.')) return;
    button.disabled=true;button.textContent='CAMBIANDO…';
    try{
      const response=await fetch('/api/v1/restaurante/mesas/'+encodeURIComponent(tableId)+'/qr-visita/regenerar',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.token,'x-tenant-subdomain':s.subdomain},body:'{}'});
      let body={};try{body=await response.json();}catch{}
      if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
      await refreshCode(true);
    }catch(error){renderError(tableId,error.message);}
  }
  function scheduleBurst(forceFirst=false){
    const token=++burstToken;
    [0,90,220,500,1000,1800,3200].forEach((delay,index)=>setTimeout(()=>{
      if(token!==burstToken) return;
      refreshCode(forceFirst&&index===0).catch(()=>{});
    },delay));
  }

  ensureStyles();
  document.addEventListener('click',(event)=>{
    const target=event.target.closest?.('[data-tab="mesero"],[data-waiter-table],#waiterOpenTable,[data-draft-plus],[data-draft-minus],[data-billing-mode],[data-waiter-seat],#addWaiterPerson,#sendDraft,#prepareAccount,#sendToCash');
    if(target) scheduleBurst(true);
  },true);
  document.addEventListener('change',(event)=>{
    if(event.target.closest?.('#waiterZone,.waiter-move-select')) scheduleBurst(true);
  },true);
  window.addEventListener('vantix:tenant-realtime',()=>scheduleBurst(true));
  window.addEventListener('vantix:tenant-realtime-ready',()=>scheduleBurst(true));
  window.addEventListener('pageshow',()=>scheduleBurst(false));
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>scheduleBurst(true),{once:true});
  else scheduleBurst(true);
  window[MARKER]=Object.freeze({version:'27.0.0',visitCodeVisible:true,eventDriven:true,noPolling:true,observerFree:true});
})();
`;

function patchWaiterVisitCodeRuntime(source) {
  if (!source || source.includes(WAITER_VISIT_CODE_MARKER)) return source;
  return `${source}\n${waiterVisitCodeRuntime}\n`;
}

function installWaiterVisitCodeRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const patched = patchWaiterVisitCodeRuntime(source);
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Waiter-Visit-Code', 'v27-event-driven');
    return originalSend(body);
  };
  return next();
}

module.exports = {
  WAITER_VISIT_CODE_MARKER,
  waiterVisitCodeRuntime,
  patchWaiterVisitCodeRuntime,
  installWaiterVisitCodeRuntime
};
