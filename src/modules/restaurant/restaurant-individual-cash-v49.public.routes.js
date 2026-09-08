'use strict';

const { MARKER: PERSON_PRODUCT_SPLIT_V76_MARKER, runtime: personProductSplitV76Runtime } = require('./restaurant-person-product-split-v76.public.routes');

const MARKER = 'VANTIX_RESTAURANT_INDIVIDUAL_CASH_V49';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_INDIVIDUAL_CASH_V49';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({version:'49.0.1',individualBillingAware:true,equalSplitHidden:true,bySeatPreferred:true,realtimeSafe:true});

  const SESSION_KEY='vantixgc_core_session_v1';
  let session=null;
  try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}
  if(!session?.token||!session?.subdomain) return;

  const nativeFetch=window.fetch.bind(window);
  const $=(q,r=document)=>r.querySelector(q);
  let busy=false;
  let lastTableId='';
  let individual=false;
  let refreshToken=0;

  async function api(path){
    const response=await nativeFetch(path,{cache:'no-store',headers:{Authorization:'Bearer '+session.token,'x-tenant-subdomain':session.subdomain}});
    let body={}; try{body=await response.json()}catch{}
    if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
    return body.data;
  }

  function selectedTableId(){return $('[data-cash-table].selected')?.dataset.cashTable||null;}

  function ensureStyle(){
    if($('#individualCashV49Style')) return;
    const style=document.createElement('style');
    style.id='individualCashV49Style';
    style.textContent='.cash-individual-note-v49{margin:10px 0;padding:11px 12px;border:1px solid #bbf7d0;border-radius:12px;background:#f0fdf4;color:#166534;font-size:12px;line-height:1.4}.cash-individual-note-v49 b{display:block;margin-bottom:2px}.cash-individual-mode-v49 #restaurantSplitEntry{background:#0d6b43!important;border-color:#0d6b43!important;color:#fff!important}.cash-individual-mode-v49 #closeTable{background:#fff!important;border-color:#cbd5e1!important;color:#334155!important;box-shadow:none!important}';
    document.head.appendChild(style);
  }

  function clearIndividualPresentation(){
    const panel=$('.cash-fast-panel');
    panel?.classList.remove('cash-individual-mode-v49');
    $('#cashIndividualNoteV49',panel||document)?.remove();
    const parts=$('#parts',panel||document);
    const partsLabel=parts?.closest('label');
    if(partsLabel) partsLabel.hidden=false;
  }

  function applyIndividualPresentation(){
    const panel=$('.cash-fast-panel');
    if(!panel||!individual) return;
    ensureStyle();
    panel.classList.add('cash-individual-mode-v49');

    const parts=$('#parts',panel);
    const partsLabel=parts?.closest('label');
    if(partsLabel) partsLabel.hidden=true;

    const details=$('.cash-more-options',panel);
    if(details){
      const summary=$('summary',details); if(summary) summary.textContent='Propina';
      const body=$(':scope > div',details); if(body) body.style.gridTemplateColumns='1fr';
    }

    let note=$('#cashIndividualNoteV49',panel);
    if(!note){
      note=document.createElement('div');
      note.id='cashIndividualNoteV49';
      note.className='cash-individual-note-v49';
      note.innerHTML='<b>Cuenta individual · cada persona paga lo suyo</b><span>Los consumos ya están asignados por persona. Usa “Cobrar por persona” para registrar cada pago sin volver a dividir la cuenta.</span>';
      (details||$('#closeTable',panel))?.insertAdjacentElement('beforebegin',note);
    }

    const entry=$('#restaurantSplitEntry',panel);
    if(entry){
      if(!/PENDIENTE|PAGADA/.test(entry.textContent||'')) entry.textContent='COBRAR POR PERSONA · CADA UNO PAGA LO SUYO';
      const close=$('#closeTable',panel);
      if(close&&entry.nextElementSibling!==close) close.insertAdjacentElement('beforebegin',entry);
    }

    const close=$('#closeTable',panel);
    if(close&&!close.disabled&&!/Cuenta separada activa/i.test(close.textContent||'')) close.title='Cobrar la cuenta completa sólo si el grupo cambia de decisión';
  }

  function tuneSplitDialog(){
    if(!individual) return;
    const dialog=$('#restaurantSplitPaymentDialog');
    if(!dialog?.open) return;
    const equal=$('[data-split-mode="EQUAL"]',dialog);
    if(equal) equal.hidden=true;
    const equalBox=$('#rvpEqual',dialog); if(equalBox) equalBox.hidden=true;
    const bySeat=$('[data-split-mode="BY_SEAT"]',dialog);
    const together=$('[data-split-mode="TOGETHER"]',dialog);
    if(bySeat&&!dialog.dataset.individualV49){
      dialog.dataset.individualV49='1';
      bySeat.click();
      if(together) together.classList.remove('selected');
      bySeat.classList.add('selected');
    }
    const note=$('.rvp-note',dialog);
    if(note&&!note.dataset.individualV49){
      note.dataset.individualV49='1';
      note.innerHTML='<b>Esta mesa fue abierta como cuenta individual.</b><br>El sistema tomará automáticamente los productos de Persona 1, Persona 2… para cobrar exactamente lo que consumió cada uno.';
    }
  }

  async function refresh(){
    if(busy) return;
    const tableId=selectedTableId();
    if(!tableId){
      lastTableId=''; individual=false;
      $('#restaurantSplitPaymentDialog')?.removeAttribute('data-individual-v49');
      clearIndividualPresentation();
      return;
    }
    if(tableId!==lastTableId){
      $('#restaurantSplitPaymentDialog')?.removeAttribute('data-individual-v49');
      busy=true;
      try{
        const rows=await api('/api/v1/restaurante/mesas');
        const table=(Array.isArray(rows)?rows:[]).find((row)=>row.id===tableId);
        individual=String(table?.activeSession?.billingMode||'').toUpperCase()==='INDIVIDUAL';
        lastTableId=tableId;
      }catch{individual=false;lastTableId=tableId}
      finally{busy=false;}
    }
    if(individual){applyIndividualPresentation();tuneSplitDialog();}
    else clearIndividualPresentation();
  }

  function scheduleRefresh(){
    const token=++refreshToken;
    const delays=[0,40,120,300,700];
    delays.forEach((delay)=>setTimeout(()=>{
      if(token!==refreshToken) return;
      refresh().catch(()=>{});
    },delay));
  }

  document.addEventListener('click',(event)=>{
    if(event.target?.closest?.('[data-tab],[data-cash-table],#restaurantSplitEntry,[data-split-mode]')) scheduleRefresh();
  },true);
  document.addEventListener('change',(event)=>{
    if(event.target?.closest?.('[data-cash-table],#cashTable')) scheduleRefresh();
  },true);
  window.addEventListener('vantix:tenant-realtime',scheduleRefresh);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',scheduleRefresh,{once:true}); else scheduleRefresh();
})();
`;

function installRestaurantIndividualCashV49(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      let patched = source;
      if (!patched.includes(MARKER)) patched = `${patched}\n;${runtime}\n`;
      if (!patched.includes(PERSON_PRODUCT_SPLIT_V76_MARKER)) patched = `${patched}\n;${personProductSplitV76Runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Restaurant-Individual-Cash', 'v49-by-seat');
    res.set('X-VantixGC-Person-Product-Split', 'v76.1-visible-entry-recovery');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installRestaurantIndividualCashV49 };
