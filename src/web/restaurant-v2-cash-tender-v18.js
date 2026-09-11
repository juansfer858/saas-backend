/* VANTIX_RESTAURANT_V2_CASH_TENDER_V18 */
(()=>{'use strict';
const MARKER='VANTIX_RESTAURANT_V2_CASH_TENDER_V18';
if(window[MARKER])return;
window[MARKER]=Object.freeze({version:'18.1.0',customerName:true,customerMaster:true,customerAnyPayment:true,cashReceived:true,cashChange:true,cashAccountingExact:true});

const DEFAULT_CUSTOMER='Cliente genérico';
const isCashPage=location.pathname==='/app/restaurante-v2/caja';
const isSplitPage=location.pathname==='/app/restaurante-v2/division';
if(!isCashPage&&!isSplitPage)return;
const RV2=window.RestaurantV2;
if(!RV2)return;

let lastSaleKey='';
let lastPartKey='';
let lastTender=null;
let chargeInFlight=false;
let syncing=false;
let observer=null;
let customerPanelOpen=false;
let pendingCustomerRestore=null;
let suppressCustomerRestore=false;
const OBSERVER_OPTIONS={subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','open']};

function $(q,root=document){return root.querySelector(q)}
function money(value){return RV2.money(Number(value||0))}
function normalizeName(value){const clean=String(value??'').replace(/\s+/g,' ').trim().slice(0,160);return clean||DEFAULT_CUSTOMER}
function parseMoney(text){
  const raw=String(text??'').replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
  if(!raw)return 0;
  const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/\./g,'');
  const value=Number(normalized);
  return Number.isFinite(value)?value:0;
}
function activeMethodKind(){
  const active=$('#paymentMethods .method-btn.active');
  if(!active)return null;
  const text=String(active.textContent||'').toUpperCase();
  if(text.includes('EFECTIVO'))return 'EFECTIVO';
  if(text.includes('CREDITO')||text.includes('CRÉDITO'))return 'CREDITO';
  if(text.includes('TRANSFERENCIA'))return 'TRANSFERENCIA';
  if(text.includes('TARJETA'))return 'TARJETA';
  return 'OTRO';
}
function currentSelectedCustomerRow(){return isCashPage?$('#customers .customer-row.active'):null}
function currentSelectedCustomerId(){return currentSelectedCustomerRow()?.dataset?.customer||null}
function currentSelectedCustomerName(){return normalizeName($('b',currentSelectedCustomerRow()||document)?.textContent||'')}
function currentSelectedCustomerSnapshot(){
  const row=currentSelectedCustomerRow();
  if(!row)return null;
  return {id:row.dataset.customer||null,name:normalizeName($('b',row)?.textContent),detail:String($('small',row)?.textContent||'').trim()};
}
function injectStyles(){
  if($('#restaurantTenderV18Styles'))return;
  const style=document.createElement('style');
  style.id='restaurantTenderV18Styles';
  style.textContent=`
    .v18-customer-select{margin:12px 0;padding:13px 14px;border:1px solid #dbe3eb;border-radius:14px;background:#fff;display:flex;gap:12px;align-items:center;justify-content:space-between}.v18-customer-select small{display:block;color:#64748b;font-size:10px;font-weight:800;letter-spacing:.04em}.v18-customer-select strong{display:block;margin-top:3px;color:#111827;font-size:15px}.v18-customer-select span{display:block;margin-top:3px;color:#64748b;font-size:11px}.v18-customer-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.v18-customer-selected{border-color:#94a3b8;background:#f8fafc}
    .v18-customer-field{grid-column:1/-1!important;display:grid!important;gap:6px!important}.v18-customer-field>span{font-weight:800;color:#334155}.v18-customer-field small{color:#64748b;font-size:11px;font-weight:500}
    .v18-tender{margin:12px 0 14px;padding:14px;border:1px solid #dbe3eb;border-radius:14px;background:#f8fafc;display:grid;grid-template-columns:minmax(120px,.8fr) minmax(170px,1.2fr) minmax(120px,.8fr);gap:10px;align-items:end}
    .v18-tender[hidden]{display:none!important}.v18-tender-block{min-height:52px;display:flex;flex-direction:column;justify-content:center}.v18-tender-block small{display:block;color:#64748b;font-size:10px;font-weight:800;letter-spacing:.03em;text-transform:uppercase}.v18-tender-block strong{display:block;margin-top:5px;color:#111827;font-size:20px;line-height:1;font-weight:850}.v18-tender label{display:grid;gap:5px;color:#334155;font-size:11px;font-weight:800}.v18-tender input{width:100%}.v18-change strong{font-size:22px}.v18-tender-status{display:block!important;margin-top:5px!important;color:#b42318!important;font-size:10px!important;font-weight:750!important;text-transform:none!important;letter-spacing:0!important}.v18-tender-status.ok{color:#067647!important}
    @media(max-width:700px){.v18-customer-select{align-items:flex-start;flex-direction:column}.v18-customer-actions{width:100%;justify-content:flex-start}.v18-tender{grid-template-columns:1fr 1fr}.v18-tender label{grid-column:1/-1;grid-row:1}.v18-customer-field input,.v18-tender input{font-size:16px!important}}
  `;
  document.head.appendChild(style);
}

function ensureCustomerField(){
  if(!isCashPage)return null;
  const fields=$('.payment-card .payment-fields');
  if(!fields)return null;
  let input=$('#v18CustomerName');
  if(input)return input;
  const label=document.createElement('label');
  label.className='v18-customer-field';
  label.innerHTML='<span>Nombre rápido / tirilla</span><input id="v18CustomerName" class="rv2-input" maxlength="160" autocomplete="name" value="Cliente genérico"><small>Para registrar la venta a nombre de un cliente usa “Identificar cliente”.</small>';
  fields.prepend(label);
  input=$('#v18CustomerName');
  input?.addEventListener('input',()=>{ if(!input.value.trim())input.dataset.empty='1';else delete input.dataset.empty; });
  input?.addEventListener('focus',()=>{ if(!input.readOnly&&normalizeName(input.value)===DEFAULT_CUSTOMER)input.select(); });
  input?.addEventListener('blur',()=>{ input.value=normalizeName(input.value); });
  return input;
}

function ensureCustomerDialogFields(){
  if(!isCashPage)return;
  const form=$('#customerForm');
  if(!form)return;
  const dialog=$('#customerDialog');
  const eyebrow=$('.dialog-head small',dialog||document);if(eyebrow)eyebrow.textContent='CLIENTE / FACTURACIÓN';
  const title=$('.dialog-head h2',dialog||document);if(title)title.textContent='Crear cliente';
  const name=$('input[name="nombre"]',form);
  if(name&&!$('input[name="razonSocial"]',form)){
    const label=document.createElement('label');label.className='span-2';label.innerHTML='Razón social <input name="razonSocial" class="rv2-input" maxlength="200">';name.closest('label')?.insertAdjacentElement('afterend',label);
  }
  const razon=$('input[name="razonSocial"]',form);
  if(razon&&!$('input[name="direccion"]',form)){
    const label=document.createElement('label');label.className='span-2';label.innerHTML='Dirección <input name="direccion" class="rv2-input" maxlength="250">';razon.closest('label')?.insertAdjacentElement('afterend',label);
  }
}

function ensureCustomerSelector(){
  if(!isCashPage)return null;
  const creditBox=$('#creditBox');
  if(!creditBox)return null;
  const head=$('.credit-head b',creditBox);if(head)head.textContent='Cliente / facturación';
  const newCustomer=$('#newCustomer');if(newCustomer)newCustomer.textContent='+ Crear cliente';
  let selector=$('#v18CustomerSelector');
  if(selector)return selector;
  selector=document.createElement('section');
  selector.id='v18CustomerSelector';
  selector.className='v18-customer-select';
  selector.innerHTML='<div><small>CLIENTE DE LA VENTA</small><strong data-v18-customer-label>Cliente genérico</strong><span data-v18-customer-detail>Cobro rápido sin identificación.</span></div><div class="v18-customer-actions"><button data-v18-identify class="rv2-btn" type="button">IDENTIFICAR CLIENTE</button><button data-v18-generic class="rv2-btn" type="button" hidden>USAR GENÉRICO</button></div>';
  creditBox.insertAdjacentElement('beforebegin',selector);
  $('[data-v18-identify]',selector)?.addEventListener('click',()=>{
    customerPanelOpen=true;
    sync();
    const search=$('#customerSearch');
    if(search){search.dispatchEvent(new Event('input',{bubbles:true}));setTimeout(()=>search.focus(),0)}
  });
  $('[data-v18-generic]',selector)?.addEventListener('click',()=>{
    pendingCustomerRestore=null;
    customerPanelOpen=false;
    suppressCustomerRestore=true;
    const active=$('#paymentMethods .method-btn.active');
    active?.click();
    setTimeout(()=>{suppressCustomerRestore=false;const input=$('#v18CustomerName');if(input){input.readOnly=false;input.value=DEFAULT_CUSTOMER;delete input.dataset.manualCredit}sync()},0);
  });
  return selector;
}

function syncCustomerUi(){
  if(!isCashPage)return;
  ensureCustomerDialogFields();
  const selector=ensureCustomerSelector();
  const creditBox=$('#creditBox');
  if(!selector||!creditBox)return;
  const credit=activeMethodKind()==='CREDITO';
  const selected=currentSelectedCustomerSnapshot();
  creditBox.hidden=!(credit||customerPanelOpen);
  selector.classList.toggle('v18-customer-selected',Boolean(selected));
  $('[data-v18-customer-label]',selector).textContent=selected?.name||DEFAULT_CUSTOMER;
  $('[data-v18-customer-detail]',selector).textContent=selected?.detail||(credit?'Crédito requiere un cliente identificado.':'Cobro rápido sin identificación.');
  $('[data-v18-identify]',selector).textContent=selected?'CAMBIAR CLIENTE':'IDENTIFICAR CLIENTE';
  $('[data-v18-generic]',selector).hidden=!selected||credit;
  const input=ensureCustomerField();
  if(input){
    input.readOnly=Boolean(selected);
    if(selected){input.value=selected.name;delete input.dataset.manualCredit}
  }
}

function tenderHtml(){return `<div class="v18-tender-block"><small>Total a recibir</small><strong data-v18-due>$0</strong></div><label>Efectivo recibido<input data-v18-received class="rv2-input" type="number" min="0" step="100" inputmode="decimal" placeholder="Ej. 50000"></label><div class="v18-tender-block v18-change"><small>Devolución</small><strong data-v18-change>$0</strong><small class="v18-tender-status" data-v18-status>Ingresa el efectivo recibido.</small></div>`}
function ensureCashTender(){
  if(!isCashPage)return null;
  const card=$('.payment-card');
  const fields=$('.payment-card .payment-fields');
  if(!card||!fields)return null;
  let tender=$('#v18CashTender');
  if(!tender){
    tender=document.createElement('section');
    tender.id='v18CashTender';
    tender.className='v18-tender';
    tender.hidden=true;
    tender.innerHTML=tenderHtml();
    fields.insertAdjacentElement('afterend',tender);
    $('[data-v18-received]',tender)?.addEventListener('input',sync);
  }
  return tender;
}
function ensureSplitTender(){
  if(!isSplitPage)return null;
  const box=$('#payBox');
  if(!box)return null;
  let tender=$('#v18SplitTender');
  if(!tender){
    tender=document.createElement('section');
    tender.id='v18SplitTender';
    tender.className='v18-tender';
    tender.hidden=true;
    tender.innerHTML=tenderHtml();
    const reference=$('.reference-field',box);
    if(reference)reference.insertAdjacentElement('afterend',tender);else box.appendChild(tender);
    $('[data-v18-received]',tender)?.addEventListener('input',sync);
  }
  return tender;
}
function currentDue(){
  if(isCashPage)return parseMoney($('#billTotal')?.textContent)+Number($('#tipAmount')?.value||0);
  return parseMoney($('#payPartAmount')?.textContent);
}
function currentTender(){return isCashPage?$('#v18CashTender'):$('#v18SplitTender')}
function currentReceived(){return Number($('[data-v18-received]',currentTender()||document)?.value||0)}
function resetTender(){const tender=currentTender();const input=tender&&$('[data-v18-received]',tender);if(input)input.value='';lastTender=null}

function cashBaseBlocked(){
  if(!$('#detail')||$('#detail').hidden)return true;
  if(!$('#paymentMethods .method-btn.active'))return true;
  if($('#splitWarning')&&!$('#splitWarning').hidden)return true;
  if(String($('#shiftPanel')?.textContent||'').toLowerCase().includes('turno de caja cerrado'))return true;
  return chargeInFlight;
}
function splitBaseBlocked(){return !$('#payBox')||$('#payBox').hidden||!$('#paymentMethods .method-btn.active')||chargeInFlight}

function updateTender(tender){
  const cash=activeMethodKind()==='EFECTIVO';
  tender.hidden=!cash;
  if(!cash)return;
  const due=Math.max(0,currentDue());
  const received=Math.max(0,currentReceived());
  const change=Math.max(0,received-due);
  $('[data-v18-due]',tender).textContent=money(due);
  $('[data-v18-change]',tender).textContent=money(change);
  const status=$('[data-v18-status]',tender);
  if(received<=0){status.textContent='Ingresa el efectivo recibido.';status.classList.remove('ok')}
  else if(received<due){status.textContent=`Faltan ${money(due-received)}`;status.classList.remove('ok')}
  else{status.textContent=change>0?`Entregar ${money(change)}`:'Pago exacto';status.classList.add('ok')}
  const button=isCashPage?$('#charge'):$('#payPart');
  if(button)button.disabled=(isCashPage?cashBaseBlocked():splitBaseBlocked())||received<due||due<=0;
}

function syncSelectedCustomerName(){
  if(!isCashPage)return;
  const selected=currentSelectedCustomerSnapshot();
  const input=$('#v18CustomerName');
  if(selected&&input){input.value=selected.name;input.readOnly=true;delete input.dataset.manualCredit}
}
function resetForContext(){
  if(isCashPage){
    const sale=String($('#saleNumber')?.textContent||'').trim();
    if(sale&&sale!=='—'&&sale!==lastSaleKey){
      lastSaleKey=sale;
      customerPanelOpen=false;
      pendingCustomerRestore=null;
      const name=ensureCustomerField();
      if(name){name.readOnly=false;name.value=DEFAULT_CUSTOMER;delete name.dataset.manualCredit}
      resetTender();
    }
  }else{
    const box=$('#payBox');
    const part=box&&!box.hidden?`${String($('#payPartName')?.textContent||'')}|${String($('#payPartAmount')?.textContent||'')}`:'';
    if(part&&part!==lastPartKey){lastPartKey=part;resetTender()}
  }
}
function enrichResult(){
  const dialog=$('#resultDialog');
  const text=$('#resultText');
  if(!dialog?.open||!text||!lastTender)return;
  if(text.textContent.includes('Devolución:'))return;
  const selected=currentSelectedCustomerSnapshot();
  const extra=[`Recibido: ${money(lastTender.received)}`,`Devolución: ${money(lastTender.change)}`];
  if(isCashPage)extra.unshift(`Cliente: ${selected?.name||normalizeName($('#v18CustomerName')?.value)}`);
  text.textContent=`${text.textContent} ${extra.join(' · ')}.`;
}
function sync(){
  if(syncing)return;
  syncing=true;
  observer?.disconnect();
  try{
    injectStyles();
    if(isCashPage){ensureCustomerField();ensureCustomerSelector();ensureCustomerDialogFields();ensureCashTender()}else ensureSplitTender();
    resetForContext();
    syncSelectedCustomerName();
    syncCustomerUi();
    const tender=currentTender();
    if(tender)updateTender(tender);
    enrichResult();
  }finally{
    syncing=false;
    observer?.observe(document.documentElement,OBSERVER_OPTIONS);
  }
}

if(isCashPage){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init={}){
    const url=typeof input==='string'?input:String(input?.url||'');
    const method=String(init?.method||input?.method||'GET').toUpperCase();
    const isCharge=method==='POST'&&/^\/api\/v1\/restaurante\/v2\/caja\/mesas\/[^/]+\/cobrar(?:\?|$)/.test(url);
    if(!isCharge)return nativeFetch(input,init);
    let nextInit=init;
    try{
      const body=typeof init.body==='string'?JSON.parse(init.body):{};
      const selected=currentSelectedCustomerSnapshot();
      body.customerName=selected?.name||normalizeName($('#v18CustomerName')?.value);
      body.terceroId=selected?.id||body.terceroId||null;
      nextInit={...init,body:JSON.stringify(body)};
    }catch{}
    chargeInFlight=true;sync();
    try{return await nativeFetch(input,nextInit)}finally{chargeInFlight=false;setTimeout(sync,0)}
  };
}

document.addEventListener('input',(event)=>{
  if(event.target?.matches?.('#tipAmount,[data-v18-received]'))sync();
  if(event.target?.matches?.('#v18CustomerName')&&!event.target.readOnly)event.target.dataset.manualCredit='1';
},true);

document.addEventListener('click',(event)=>{
  const method=event.target?.closest?.('[data-method]');
  if(method){
    if(!suppressCustomerRestore)pendingCustomerRestore=currentSelectedCustomerSnapshot();
    lastTender=null;
    setTimeout(()=>{
      if(pendingCustomerRestore?.id){
        const row=[...document.querySelectorAll('#customers [data-customer]')].find(x=>x.dataset.customer===pendingCustomerRestore.id);
        if(row)row.click();
      }
      pendingCustomerRestore=null;
      sync();
    },0);
    return;
  }
  const customer=event.target?.closest?.('[data-customer]');
  if(customer&&isCashPage){
    customerPanelOpen=false;
    const input=$('#v18CustomerName');
    if(input)delete input.dataset.manualCredit;
    setTimeout(sync,0);
    return;
  }
  const table=event.target?.closest?.('[data-table]');
  if(table){customerPanelOpen=false;pendingCustomerRestore=null;setTimeout(sync,0);return}
  const part=event.target?.closest?.('[data-part]');
  if(part){setTimeout(sync,0);return}

  const action=isCashPage?event.target?.closest?.('#charge'):event.target?.closest?.('#payPart');
  if(!action||activeMethodKind()!=='EFECTIVO')return;
  const due=Math.max(0,currentDue());
  const received=Math.max(0,currentReceived());
  if(due<=0||received<due){
    event.preventDefault();
    event.stopImmediatePropagation();
    const input=$('[data-v18-received]',currentTender()||document);
    input?.focus();
    sync();
    return;
  }
  lastTender={due,received,change:Math.max(0,received-due)};
},true);

observer=new MutationObserver(()=>sync());
window.addEventListener('pageshow',()=>setTimeout(sync,0));
sync();
})();
