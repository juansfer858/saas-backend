'use strict';

const MARKER = 'VANTIX_RESTAURANT_CASH_CLOSE_BREAKDOWN_V45';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_CASH_CLOSE_BREAKDOWN_V45';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({
    version:'45.0.0',
    cashCloseBreakdown:true,
    cashExpectedUsesDrawerBalance:true,
    bankUsesElectronicTurnSales:true,
    creditUsesTurnCreditSales:true,
    quickCollectInlineRemoved:true,
    collectOnlyFromTable:true,
    noPolling:true
  });

  const SESSION_KEY='vantixgc_core_session_v1';
  const SHIFT_KEY='restaurant_cash_shift';
  const STYLE_ID='vantix-cash-close-breakdown-v45-style';
  let summaryCache=null;
  let summaryShiftId=null;
  let summaryAt=0;
  let burstToken=0;

  const $=(q,r=document)=>r.querySelector(q);
  const money=(value)=>{
    let session=null;
    try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}
    const currency=session?.tenant?.moneda||'COP';
    return new Intl.NumberFormat('es-CO',{style:'currency',currency,maximumFractionDigits:0}).format(Number(value||0));
  };

  function session(){
    try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}
  }

  function shiftId(){return localStorage.getItem(SHIFT_KEY)||''}

  function ensureStyle(){
    if(document.getElementById(STYLE_ID)) return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=\`
      #view .cash-workspace.cash-table-collect-only-v45{grid-template-columns:minmax(0,1fr)!important}
      #view .cash-fast-panel.cash-table-collect-only-v45:not(.cash-collect-dialog-v40){display:none!important}
      #view .cash-fast-panel.cash-table-collect-only-v45.cash-collect-dialog-v40{display:block!important}
      .cash-payment-breakdown-v45{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:4px 0 14px}
      .cash-payment-card-v45{border:1px solid #d7e1ec;border-radius:13px;background:#fff;padding:12px;display:grid;gap:4px;min-width:0}
      .cash-payment-card-v45 small{font-size:10px;color:#637997;font-weight:800;text-transform:uppercase;letter-spacing:.03em}
      .cash-payment-card-v45 b{font-size:20px;color:#10233f;font-weight:950;letter-spacing:-.02em}
      .cash-payment-card-v45 span{font-size:10px;color:#718096;font-weight:700;line-height:1.35}
      .cash-payment-card-v45.cash-v45{border-color:#b9decf;background:#f3fbf7}
      .cash-payment-card-v45.bank-v45{border-color:#c9d9f3;background:#f5f8ff}
      .cash-payment-card-v45.credit-v45{border-color:#ead8ae;background:#fffbef}
      @media(max-width:699px){.cash-payment-breakdown-v45{grid-template-columns:1fr}.cash-payment-card-v45{padding:11px}.cash-payment-card-v45 b{font-size:18px}}
    \`;
    document.head.appendChild(style);
  }

  async function loadSummary(force=false){
    const id=shiftId();
    const auth=session();
    if(!id||!auth?.token||!auth?.subdomain) return null;
    const now=Date.now();
    if(!force&&summaryCache&&summaryShiftId===id&&now-summaryAt<1200) return summaryCache;
    const response=await fetch('/api/v1/restaurante/caja/turnos/'+encodeURIComponent(id)+'/resumen',{
      cache:'no-store',
      headers:{Authorization:'Bearer '+auth.token,'x-tenant-subdomain':auth.subdomain}
    });
    let body={};
    try{body=await response.json()}catch{}
    if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
    summaryCache=body.data||null;
    summaryShiftId=id;
    summaryAt=Date.now();
    return summaryCache;
  }

  function tableCollectOnly(){
    ensureStyle();
    const shell=$('#view .cash-shell');
    if(!shell) return;
    const workspace=$('.cash-workspace',shell);
    const fast=$('.cash-fast-panel',shell);
    if(workspace) workspace.classList.add('cash-table-collect-only-v45');
    if(!fast) return;
    fast.classList.add('cash-table-collect-only-v45');
    const title=$('.cash-panel-head h2',fast);
    if(title){
      const table=$('.cash-selected-summary b',fast)?.textContent?.trim();
      title.textContent=table?'Cobrar '+table:'Cobrar mesa';
    }
    const subtitle=$('.cash-panel-head p',fast);
    if(subtitle) subtitle.textContent='El cobro se inicia desde la mesa seleccionada.';
  }

  function renderBreakdown(summary){
    const panel=$('.cash-close-panel');
    if(!panel||!summary) return;
    const breakdown=summary.paymentBreakdown||{};
    let root=$('.cash-payment-breakdown-v45',panel);
    if(!root){
      root=document.createElement('div');
      root.className='cash-payment-breakdown-v45';
      const lines=$('.cash-close-lines',panel);
      if(lines) panel.insertBefore(root,lines); else panel.prepend(root);
    }
    root.innerHTML=\`
      <article class="cash-payment-card-v45 cash-v45"><small>Efectivo esperado en caja</small><b>\${money(summary.systemCashExpected)}</b><span>Ventas en efectivo: \${money(breakdown.cashSales)} · incluye fondo inicial y movimientos físicos del turno.</span></article>
      <article class="cash-payment-card-v45 bank-v45"><small>Banco / Tarjeta / QR</small><b>\${money(breakdown.electronicSales)}</b><span>Recaudos electrónicos registrados durante este turno.</span></article>
      <article class="cash-payment-card-v45 credit-v45"><small>Crédito / cartera</small><b>\${money(breakdown.creditSales)}</b><span>Ventas del turno que quedaron pendientes por cobrar al cliente.</span></article>
    \`;
    panel.dataset.cashCloseBreakdown='v45';
  }

  async function enhance(force=false){
    tableCollectOnly();
    if(!shiftId()) return;
    try{renderBreakdown(await loadSummary(force))}catch{}
  }

  function scheduleBurst(force=false){
    const token=++burstToken;
    [0,80,180,360,700,1200].forEach((delay)=>setTimeout(()=>{
      if(token!==burstToken) return;
      enhance(force&&delay===0).catch(()=>{});
    },delay));
  }

  document.addEventListener('click',(event)=>{
    const table=event.target?.closest?.('[data-cash-table]');
    if(table){scheduleBurst(false);return}
    if(event.target?.closest?.('#closeTable')){summaryAt=0;setTimeout(()=>scheduleBurst(true),120);return}
    if(event.target?.closest?.('[data-tab="caja"],[data-cc-tab="caja"],.cash-compact-summary-v30')) scheduleBurst(false);
  },true);
  window.addEventListener('vantix:tenant-realtime',()=>{summaryAt=0;scheduleBurst(true)});
  window.addEventListener('vantix:tenant-realtime-ready',()=>scheduleBurst(true));
  window.addEventListener('pageshow',()=>scheduleBurst(false));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scheduleBurst(false),{once:true});
  else scheduleBurst(false);
})();
`;

function installRestaurantCashCloseBreakdownV45(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n;${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Restaurant-Cash-Close', 'v45-payment-breakdown-table-collect');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installRestaurantCashCloseBreakdownV45 };
