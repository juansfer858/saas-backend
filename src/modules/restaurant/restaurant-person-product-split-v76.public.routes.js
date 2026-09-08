'use strict';

const MARKER = 'VANTIX_RESTAURANT_PERSON_PRODUCT_SPLIT_V76';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_PERSON_PRODUCT_SPLIT_V76';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({
    version:'76.1.0',
    cashPersonProductSplit:true,
    preservesEqualSplit:true,
    reusesSplitPaymentEngine:true,
    independentPartPayments:true,
    selfHealingSplitEntry:true,
    verifiesVisibleEntry:true
  });

  const SESSION_KEY='vantixgc_core_session_v1';
  const FALLBACK_ID='restaurantSplitFallbackV761';
  const RECOVERY_SCRIPT_ID='restaurantSplitRecoveryScriptV761';
  let session=null;
  try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}
  if(!session?.token||!session?.subdomain) return;

  const nativeFetch=window.fetch.bind(window);
  const $=(q,r=document)=>r.querySelector(q);
  const $$=(q,r=document)=>[...r.querySelectorAll(q)];
  let scheduled=false;
  let preferProductMode=false;
  let enrichBusy=false;
  let enrichKey='';
  let recoveryPromise=null;
  let recoveryTableId='';

  async function api(path){
    const response=await nativeFetch(path,{
      cache:'no-store',
      headers:{Authorization:'Bearer '+session.token,'x-tenant-subdomain':session.subdomain}
    });
    let body={};
    try{body=await response.json()}catch{}
    if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
    return body.data;
  }

  function selectedTableId(){
    return $('[data-cash-table].selected')?.dataset.cashTable||null;
  }

  function cashPanel(){
    return $('#view .cash-fast-panel')||$('.cash-fast-panel');
  }

  function isIndividualCash(){
    const panel=cashPanel();
    if(!panel) return false;
    if(panel.classList.contains('cash-individual-mode-v49')||$('#cashIndividualNoteV49',panel)) return true;
    return /COBRAR POR PERSONA · CADA UNO PAGA LO SUYO/i.test($('#restaurantSplitEntry',panel)?.textContent||'');
  }

  function guestCountFromCash(){
    const text=$('.cash-selected-summary small',cashPanel()||document)?.textContent||'';
    const match=text.match(/(\d+)\s+persona/i);
    const value=Number(match?.[1]||1);
    return Number.isInteger(value)&&value>0?Math.min(value,50):1;
  }

  function ensureStyles(){
    if($('#restaurantPersonProductSplitV76Style')) return;
    const style=document.createElement('style');
    style.id='restaurantPersonProductSplitV76Style';
    style.textContent='\n      .cash-person-product-entry-v76{width:100%;margin:12px 0 4px!important;min-height:58px!important;border:2px solid #0d6b43!important;border-radius:13px!important;background:#0d6b43!important;color:#fff!important;font-weight:900!important;font-size:14px!important;box-shadow:0 8px 18px rgba(13,107,67,.14);cursor:pointer}\n      .cash-person-product-entry-v76[disabled]{opacity:.65;cursor:wait}\n      .cash-split-hint-v76{margin:0 0 10px;padding:0 2px;color:#667178;font-size:11px;line-height:1.4}\n      .cash-equal-help-v76{display:block;margin-top:4px;color:#667178;font-size:10px;font-weight:600;line-height:1.3}\n      .rvp-people-v76{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:12px;align-items:end;margin-top:12px;padding:12px;border:1px solid #bbf7d0;border-radius:12px;background:#f0fdf4}\n      .rvp-people-v76 b{display:block;color:#166534;font-size:13px}.rvp-people-v76 span{display:block;margin-top:3px;color:#667178;font-size:11px;line-height:1.35}\n      .rvp-people-v76 label{display:grid;gap:5px;font-size:11px;font-weight:850;color:#334155}.rvp-people-v76 input{min-height:44px;width:100%;border:1px solid #b9c8c0;border-radius:9px;background:#fff;padding:0 10px;font-weight:900;font-size:16px}\n      .rvp-products-v76{margin-top:5px;color:#475569;font-size:11px;line-height:1.4}\n      @media(max-width:640px){.rvp-people-v76{grid-template-columns:1fr}}\n    ';
    document.head.appendChild(style);
  }

  function equalLabelPresentation(panel){
    const parts=$('#parts',panel);
    const label=parts?.closest('label');
    if(!label) return;
    if(!label.dataset.personSplitV761){
      label.dataset.personSplitV761='1';
      const textNode=[...label.childNodes].find((node)=>node.nodeType===Node.TEXT_NODE&&/Dividir en partes iguales|Partes iguales/i.test(node.nodeValue||''));
      if(textNode) textNode.nodeValue='Partes iguales (opcional)';
      if(!$('.cash-equal-help-v76',label)){
        const help=document.createElement('span');
        help.className='cash-equal-help-v76';
        help.textContent='Sólo reparte el valor total por igual. Para separar lo que consumió cada persona usa el botón verde.';
        label.appendChild(help);
      }
    }
  }

  function canonicalEntry(tableId){
    const entry=$('#restaurantSplitEntry',cashPanel()||document);
    return entry&&(!tableId||entry.dataset.tableId===tableId)?entry:null;
  }

  function waitForCanonicalEntry(tableId,timeoutMs=3500){
    return new Promise((resolve)=>{
      const started=Date.now();
      const tick=()=>{
        const entry=canonicalEntry(tableId);
        if(entry) return resolve(entry);
        if(Date.now()-started>=timeoutMs) return resolve(null);
        setTimeout(tick,60);
      };
      tick();
    });
  }

  function wakeCanonicalObserver(panel){
    if(!panel) return;
    const probe=document.createElement('span');
    probe.hidden=true;
    probe.setAttribute('data-v76-split-wakeup','1');
    panel.appendChild(probe);
    queueMicrotask(()=>probe.remove());
  }

  function loadCanonicalSplitUi(tableId){
    const existing=canonicalEntry(tableId);
    if(existing) return Promise.resolve(existing);
    if(recoveryPromise&&recoveryTableId===tableId) return recoveryPromise;
    recoveryTableId=tableId;
    recoveryPromise=(async()=>{
      const panel=cashPanel();
      wakeCanonicalObserver(panel);
      await new Promise((resolve)=>setTimeout(resolve,120));
      let entry=canonicalEntry(tableId);
      if(entry) return entry;

      let script=$('#'+RECOVERY_SCRIPT_ID);
      if(!script){
        script=document.createElement('script');
        script.id=RECOVERY_SCRIPT_ID;
        script.src='/app/restaurant-visit-payments-ui.js?v=v76-1-recovery';
        script.async=true;
        document.head.appendChild(script);
      }
      await new Promise((resolve,reject)=>{
        if(script.dataset.loaded==='1') return resolve();
        const done=()=>{script.dataset.loaded='1';resolve();};
        const fail=()=>reject(new Error('No se pudo cargar el motor visual de cuenta separada.'));
        script.addEventListener('load',done,{once:true});
        script.addEventListener('error',fail,{once:true});
      });
      wakeCanonicalObserver(cashPanel());
      entry=await waitForCanonicalEntry(tableId,3500);
      if(!entry) throw new Error('La división de cuenta no pudo montarse en Caja.');
      return entry;
    })().finally(()=>{recoveryPromise=null;});
    return recoveryPromise;
  }

  function placeFallbackEntry(panel,tableId,details){
    if(!panel||!tableId||isIndividualCash()) return;
    let fallback=$('#'+FALLBACK_ID,panel);
    if(!fallback){
      fallback=document.createElement('button');
      fallback.id=FALLBACK_ID;
      fallback.type='button';
      fallback.className='cash-person-product-entry-v76';
      fallback.textContent='DIVIDIR CUENTA · PRODUCTOS / PERSONAS';
      fallback.addEventListener('click',async()=>{
        const currentTable=selectedTableId();
        if(!currentTable) return;
        preferProductMode=true;
        fallback.disabled=true;
        fallback.textContent='ABRIENDO DIVISIÓN…';
        try{
          const entry=await loadCanonicalSplitUi(currentTable);
          fallback.remove();
          entry.click();
          schedule();
        }catch(error){
          alert(error.message||'No fue posible abrir la división de cuenta.');
          fallback.disabled=false;
          fallback.textContent='DIVIDIR CUENTA · PRODUCTOS / PERSONAS';
        }
      });
    }
    fallback.dataset.tableId=tableId;
    if(details&&fallback.nextElementSibling!==details) details.insertAdjacentElement('beforebegin',fallback);
  }

  function placeCashEntry(){
    const panel=cashPanel();
    const tableId=selectedTableId();
    if(!panel||!tableId) return;
    ensureStyles();
    equalLabelPresentation(panel);

    const details=$('.cash-more-options',panel);
    if(details&&!isIndividualCash()){
      const summary=$('summary',details);
      if(summary&&summary.textContent!=='Propina y partes iguales (opcional)') summary.textContent='Propina y partes iguales (opcional)';
    }

    const entry=canonicalEntry(tableId);
    if(!entry){
      placeFallbackEntry(panel,tableId,details);
      loadCanonicalSplitUi(tableId).then(()=>schedule()).catch(()=>{});
      return;
    }

    $('#'+FALLBACK_ID,panel)?.remove();
    if(isIndividualCash()){
      entry.classList.remove('cash-person-product-entry-v76');
      $('#cashSplitHintV76',panel)?.remove();
      return;
    }

    const liveText=entry.textContent||'';
    if(!/PENDIENTE|PAGADA|Cuenta separada activa/i.test(liveText)) entry.textContent='DIVIDIR CUENTA · PRODUCTOS / PERSONAS';
    entry.classList.add('cash-person-product-entry-v76');

    const next=entry.nextElementSibling;
    const placementOk=Boolean(details&&entry.parentElement===details.parentElement&&(next===details||next?.id==='cashSplitHintV76'));
    if(details&&!placementOk) details.insertAdjacentElement('beforebegin',entry);

    let hint=$('#cashSplitHintV76',panel);
    if(!hint&&!/PENDIENTE|PAGADA/i.test(liveText)){
      hint=document.createElement('div');
      hint.id='cashSplitHintV76';
      hint.className='cash-split-hint-v76';
      hint.textContent='Asigna cada producto a Persona 1, Persona 2… y cobra cada cuenta por separado.';
      entry.insertAdjacentElement('afterend',hint);
    }
    if(hint&&entry.nextElementSibling!==hint) entry.insertAdjacentElement('afterend',hint);
  }

  function peopleCount(){
    const input=$('#rvpPeopleCountV76');
    const value=Number(input?.value||Math.max(2,guestCountFromCash()));
    return Math.max(2,Math.min(50,Number.isInteger(value)?value:2));
  }

  function updateManualPeople(){
    const dialog=$('#restaurantSplitPaymentDialog');
    if(!dialog?.open) return;
    const count=peopleCount();
    $$('.rvp-manual-row select',dialog).forEach((select)=>{
      const current=Math.max(1,Math.min(count,Number(select.value||1)));
      if(select.dataset.peopleV76===String(count)&&select.options.length===count) return;
      let html='';
      for(let seat=1;seat<=count;seat+=1) html+='<option value="'+seat+'"'+(seat===current?' selected':'')+'>Persona '+seat+'</option>';
      select.innerHTML=html;
      select.value=String(current);
      select.dataset.peopleV76=String(count);
    });
  }

  function ensurePeopleControl(dialog){
    const manual=$('#rvpManual',dialog);
    if(!manual) return;
    let control=$('#rvpPeopleV76',dialog);
    if(!control){
      control=document.createElement('div');
      control.id='rvpPeopleV76';
      control.className='rvp-people-v76';
      const initial=Math.max(2,guestCountFromCash());
      control.innerHTML='<div><b>¿Entre cuántas personas se divide?</b><span>Luego asigna cada producto a la persona que lo consumió. Una línea completa queda a cargo de una sola persona.</span></div><label>Personas<input id="rvpPeopleCountV76" type="number" min="2" max="50" value="'+initial+'" inputmode="numeric"></label>';
      manual.insertAdjacentElement('beforebegin',control);
      const input=$('#rvpPeopleCountV76',control);
      input?.addEventListener('input',updateManualPeople);
      input?.addEventListener('change',updateManualPeople);
    }
    control.hidden=false;
    updateManualPeople();
  }

  function tuneChoiceScreen(dialog){
    const modes=$$('[data-split-mode]',dialog);
    if(!modes.length) return false;
    const h2=$('.rvp-head h2',dialog);
    if(h2) h2.textContent='Dividir cuenta';
    const byItem=$('[data-split-mode="BY_ITEM"]',dialog);
    if(byItem){
      const title=$('b',byItem); if(title) title.textContent='Por productos y personas';
      const copy=$('span',byItem); if(copy) copy.textContent='Elige cuántas personas hay y asigna cada producto a quien corresponda.';
    }
    const bySeat=$('[data-split-mode="BY_SEAT"]',dialog);
    if(bySeat){
      const title=$('b',bySeat); if(title) title.textContent='Personas ya asignadas';
      const copy=$('span',bySeat); if(copy) copy.textContent='Usa Persona 1, Persona 2… cuando el Mesero ya repartió los productos.';
    }

    const productSelected=Boolean(byItem?.classList.contains('selected'));
    const control=$('#rvpPeopleV76',dialog);
    if(control) control.hidden=!productSelected;
    if(productSelected) ensurePeopleControl(dialog);

    if(preferProductMode&&!isIndividualCash()&&byItem&&!dialog.dataset.productAutoV761){
      dialog.dataset.productAutoV761='1';
      preferProductMode=false;
      setTimeout(()=>{
        if(dialog.open&&byItem.isConnected){
          byItem.click();
          schedule();
        }
      },0);
    }
    return true;
  }

  async function enrichPaymentParts(dialog){
    if(enrichBusy) return;
    const rows=$$('.rvp-part',dialog);
    const tableId=selectedTableId();
    if(!rows.length||!tableId) return;
    enrichBusy=true;
    try{
      const summary=await api('/api/v1/restaurante/mesas/'+encodeURIComponent(tableId)+'/pagos-divididos');
      if(!summary?.prepared||!['BY_ITEM','BY_SEAT'].includes(String(summary.mode||''))) return;
      const signature=tableId+'|'+summary.sessionId+'|'+summary.parts.map((part)=>part.key+':'+(part.paid?'1':'0')).join(',');
      if(enrichKey===signature&&rows.every((row)=>row.querySelector('.rvp-products-v76'))) return;
      const service=await api('/api/v1/restaurante/sesiones/'+encodeURIComponent(summary.sessionId));
      const details=service?.sale?.detalles||[];
      const detailMap=new Map(details.map((detail)=>[detail.id,detail]));
      rows.forEach((row,index)=>{
        row.querySelector('.rvp-products-v76')?.remove();
        const part=summary.parts?.[index];
        if(!part) return;
        const names=(part.saleDetailIds||[]).map((id)=>detailMap.get(id)).filter(Boolean).map((detail)=>{
          const quantity=Number(detail.cantidad||0);
          const qtyText=Number.isInteger(quantity)?String(quantity):String(detail.cantidad||'');
          return qtyText+'× '+String(detail.descripcion||'Producto');
        });
        if(!names.length) return;
        const copy=row.firstElementChild;
        if(!copy) return;
        const list=document.createElement('div');
        list.className='rvp-products-v76';
        list.textContent='Productos: '+names.join(' · ');
        copy.appendChild(list);
      });
      const h2=$('.rvp-head h2',dialog);
      if(h2) h2.textContent='Cobrar por persona';
      enrichKey=signature;
    }catch(error){
      console.warn('[V76.1] No fue posible enriquecer productos por persona',error);
    }finally{
      enrichBusy=false;
    }
  }

  function tuneDialog(){
    const dialog=$('#restaurantSplitPaymentDialog');
    if(!dialog?.open) return;
    if(isIndividualCash()) return;
    const choice=tuneChoiceScreen(dialog);
    if(!choice){
      preferProductMode=false;
      enrichPaymentParts(dialog);
    }
  }

  function validateProductSplitBeforePrepare(event){
    const button=event.target?.closest?.('#rvpPrepare');
    if(!button) return;
    const dialog=$('#restaurantSplitPaymentDialog');
    if(!dialog?.open) return;
    const byItem=$('[data-split-mode="BY_ITEM"].selected',dialog);
    if(!byItem) return;
    const rows=$$('.rvp-manual-row',dialog);
    if(!rows.length) return;
    const seats=new Set(rows.map((row)=>Number($('select',row)?.value||0)).filter((seat)=>seat>0));
    if(seats.size>=2) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    alert('Asigna productos al menos a 2 personas antes de preparar la cuenta.');
  }

  function schedule(){
    if(scheduled) return;
    scheduled=true;
    queueMicrotask(()=>{
      scheduled=false;
      try{placeCashEntry();tuneDialog();}catch(error){console.warn('[V76.1] UI',error)}
    });
  }

  document.addEventListener('click',(event)=>{
    validateProductSplitBeforePrepare(event);
    const entry=event.target?.closest?.('#restaurantSplitEntry');
    if(entry&&!isIndividualCash()&&!/PENDIENTE|PAGADA/i.test(entry.textContent||'')) preferProductMode=true;
    if(event.target?.closest?.('[data-cash-table],[data-split-mode],#restaurantSplitEntry,#'+FALLBACK_ID+',#rvpPrepare,[data-pay-part]')) schedule();
  },true);

  document.addEventListener('change',(event)=>{
    if(event.target?.matches?.('#rvpPeopleCountV76,.rvp-manual-row select')) schedule();
  },true);

  const observer=new MutationObserver(schedule);
  if(document.body) observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','open','hidden']});
  window.addEventListener('vantix:tenant-realtime',schedule);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',schedule,{once:true}); else schedule();
})();
`;

function installRestaurantPersonProductSplitV76(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n;${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Person-Product-Split', 'v76.1-visible-entry-recovery');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installRestaurantPersonProductSplitV76 };
