/* VANTIX_RESTAURANT_V2_CASH_PRINT_CHOICE_V19 */
(()=>{'use strict';
const MARKER='VANTIX_RESTAURANT_V2_CASH_PRINT_CHOICE_V19';
if(window[MARKER])return;
window[MARKER]=Object.freeze({version:'19.2.0',postSettlement:true,yesNo:true,defaultNoPrint:true,paymentFirst:true,visibleChargeErrors:true,postSaleCustomerNameEdit:true});
if(location.pathname!=='/app/restaurante-v2/caja')return;
const RV2=window.RestaurantV2;if(!RV2)return;

let pending=null;
let rendering=false;
const $=(q,root=document)=>root.querySelector(q);

function ensureStyle(){
  if($('#restaurantCashPrintChoiceV19Style'))return;
  const style=document.createElement('style');
  style.id='restaurantCashPrintChoiceV19Style';
  style.textContent=`
    .v19-print-choice{margin:16px 0 4px;padding:15px;border:1px solid #dbe3eb;border-radius:14px;background:#f8fafc;text-align:left}
    .v19-print-choice>small{display:block;color:#64748b;font-size:10px;font-weight:850;letter-spacing:.05em;text-transform:uppercase}
    .v19-print-choice>strong{display:block;margin-top:5px;color:#111827;font-size:18px}.v19-print-choice>p{margin:5px 0 0;color:#64748b;font-size:12px}
    .v19-name-editor{margin-top:13px;padding:12px;border:1px solid #dbe3eb;border-radius:12px;background:#fff}
    .v19-name-editor label{display:block;color:#334155;font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.04em}
    .v19-name-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:7px}.v19-name-row .rv2-input{min-width:0}
    .v19-name-status{margin:7px 0 0!important;color:#475569!important;font-size:11px!important}.v19-name-status.error{color:#b42318!important}
    .v19-print-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:13px}.v19-print-actions .rv2-btn{min-height:45px}
    .v19-print-status{margin-top:10px!important;color:#334155!important;font-weight:750}.v19-print-status.error{color:#b42318!important}
    .v19-charge-error{max-width:min(520px,calc(100vw - 30px));border:0;border-radius:16px;padding:0;box-shadow:0 22px 70px rgba(15,23,42,.28)}
    .v19-charge-error::backdrop{background:rgba(15,23,42,.48)}
    .v19-charge-error-card{padding:20px;display:grid;gap:10px;background:#fff;color:#111827}
    .v19-charge-error-card small{font-size:10px;font-weight:850;letter-spacing:.06em;color:#b42318;text-transform:uppercase}
    .v19-charge-error-card strong{font-size:20px}.v19-charge-error-card p{margin:0;color:#475569;line-height:1.45}
    .v19-charge-error-card code{font-size:11px;color:#64748b;white-space:normal;word-break:break-word}
    @media(max-width:520px){.v19-print-actions,.v19-name-row{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function normalizeCustomerName(value){
  const clean=String(value??'').replace(/\s+/g,' ').trim().slice(0,160);
  return clean||'Cliente genérico';
}

function cleanResultText(){
  const text=$('#resultText');if(!text)return;
  text.textContent=String(text.textContent||'')
    .replace('Tirilla POS enviada a la cola de impresión.','Venta liquidada correctamente.')
    .replace('La venta quedó registrada; la cola de impresión no confirmó el encolado.','Venta liquidada correctamente.');
}

function chargeErrorDetails(body,status){
  const error=body?.error;
  const message=String(error?.message||body?.message||(typeof error==='string'?error:'')||`El servidor rechazó el cobro (HTTP ${status||'error'}).`);
  const code=String(error?.code||body?.code||'').trim();
  return {message,code};
}

function showChargeFailure(body,status){
  ensureStyle();
  $('#v19ChargeFailure')?.remove();
  const details=chargeErrorDetails(body,status);
  const dialog=document.createElement('dialog');
  dialog.id='v19ChargeFailure';
  dialog.className='v19-charge-error';
  dialog.innerHTML='<div class="v19-charge-error-card"><small>COBRO NO REALIZADO</small><strong>No se modificó la cuenta</strong><p data-v19-charge-error-message></p><code data-v19-charge-error-code hidden></code><button type="button" class="rv2-btn rv2-btn-primary" data-v19-charge-error-close>ENTENDIDO</button></div>';
  $('[data-v19-charge-error-message]',dialog).textContent=details.message;
  const code=$('[data-v19-charge-error-code]',dialog);
  if(details.code){code.hidden=false;code.textContent=`Código: ${details.code}`}
  $('[data-v19-charge-error-close]',dialog).onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.appendChild(dialog);
  dialog.showModal();
}

function finishWithoutPrint(){
  pending=null;
  $('#v19PrintChoice')?.remove();
  const close=$('#resultClose');if(close)close.hidden=false;
  $('#resultDialog')?.close();
}

async function saveCustomerName({silent=false}={}){
  if(!pending?.saleId)return true;
  const root=$('#v19PrintChoice');
  const input=$('[data-v19-customer-name]',root);
  const save=$('[data-v19-name-save]',root);
  const status=$('[data-v19-name-status]',root);
  if(!input)return true;
  const next=normalizeCustomerName(input.value);
  input.value=next;
  if(next===normalizeCustomerName(pending.customerName)){
    if(!silent&&status){status.textContent='El nombre ya está actualizado.';status.classList.remove('error')}
    return true;
  }
  if(pending.nameBusy)return false;
  pending.nameBusy=true;
  if(save)save.disabled=true;
  if(status){status.textContent='Guardando nombre…';status.classList.remove('error')}
  try{
    const data=await RV2.api(`/api/v1/restaurante/v2/caja/ventas/${encodeURIComponent(pending.saleId)}/nombre-cliente`,{method:'PATCH',body:JSON.stringify({customerName:next})});
    pending.customerName=normalizeCustomerName(data?.customerName||next);
    input.value=pending.customerName;
    if(status)status.textContent='Nombre actualizado. La impresión usará este nombre.';
    return true;
  }catch(error){
    if(status){status.textContent=error.message||'No fue posible cambiar el nombre.';status.classList.add('error')}
    return false;
  }finally{
    pending.nameBusy=false;
    if(save)save.disabled=false;
  }
}

async function requestPrint(){
  if(!pending?.sessionId||pending.busy)return;
  const nameSaved=await saveCustomerName({silent:true});
  if(!nameSaved)return;
  pending.busy=true;
  const root=$('#v19PrintChoice');
  const yes=$('[data-v19-print-yes]',root);const no=$('[data-v19-print-no]',root);const status=$('[data-v19-print-status]',root);
  const nameInput=$('[data-v19-customer-name]',root);const nameSave=$('[data-v19-name-save]',root);
  if(yes)yes.disabled=true;if(no)no.disabled=true;if(nameInput)nameInput.disabled=true;if(nameSave)nameSave.disabled=true;
  if(status){status.textContent='Enviando recibo a impresión…';status.classList.remove('error')}
  try{
    const data=await RV2.api('/api/v1/restaurante/v2/caja/recibo/imprimir',{method:'POST',body:JSON.stringify({sessionId:pending.sessionId})});
    if(!data?.receiptRequested)throw new Error('La cola de impresión no confirmó el recibo');
    if(status)status.textContent='Recibo enviado a la cola de impresión.';
    const close=$('#resultClose');if(close){close.hidden=false;close.textContent='VOLVER A CAJA'}
    if(yes)yes.hidden=true;if(no)no.hidden=true;
    pending.printed=true;
  }catch(error){
    pending.busy=false;
    if(status){status.textContent=`La venta está liquidada, pero no se pudo enviar el recibo: ${error.message||'error de impresión'}.`;status.classList.add('error')}
    if(yes){yes.disabled=false;yes.textContent='REINTENTAR IMPRESIÓN'}
    if(no){no.disabled=false;no.textContent='NO IMPRIMIR'}
    if(nameInput)nameInput.disabled=false;if(nameSave)nameSave.disabled=false;
  }
}

function renderChoice(){
  if(rendering||!pending?.sessionId)return;
  const dialog=$('#resultDialog');if(!dialog?.open)return;
  if($('#v19PrintChoice'))return;
  rendering=true;
  try{
    ensureStyle();
    cleanResultText();
    const close=$('#resultClose');if(close)close.hidden=true;
    const root=document.createElement('section');
    root.id='v19PrintChoice';
    root.className='v19-print-choice';
    root.innerHTML='<small>VENTA LIQUIDADA</small><strong>Factura / recibo creado</strong><p>Antes de imprimir puedes corregir únicamente el nombre. No cambia productos, total, pago, Caja ni Contabilidad.</p><div class="v19-name-editor" data-v19-name-editor><label>Nombre que saldrá en el recibo</label><div class="v19-name-row"><input type="text" maxlength="160" class="rv2-input" data-v19-customer-name><button type="button" class="rv2-btn" data-v19-name-save>GUARDAR NOMBRE</button></div><p class="v19-name-status" data-v19-name-status></p></div><div class="v19-print-actions"><button type="button" class="rv2-btn rv2-btn-primary" data-v19-print-yes>SÍ, IMPRIMIR</button><button type="button" class="rv2-btn" data-v19-print-no>NO</button></div><p class="v19-print-status" data-v19-print-status></p>';
    close?.insertAdjacentElement('beforebegin',root);
    const nameInput=$('[data-v19-customer-name]',root);
    if(nameInput)nameInput.value=normalizeCustomerName(pending.customerName);
    if(!pending.saleId){const editor=$('[data-v19-name-editor]',root);if(editor)editor.hidden=true}
    $('[data-v19-name-save]',root).onclick=()=>saveCustomerName();
    $('[data-v19-print-yes]',root).onclick=requestPrint;
    $('[data-v19-print-no]',root).onclick=finishWithoutPrint;
  }finally{rendering=false}
}

const previousFetch=window.fetch.bind(window);
window.fetch=async function(input,init={}){
  const url=typeof input==='string'?input:String(input?.url||'');
  const method=String(init?.method||input?.method||'GET').toUpperCase();
  const isCharge=method==='POST'&&/^\/api\/v1\/restaurante\/v2\/caja\/mesas\/[^/]+\/cobrar(?:\?|$)/.test(url);
  const response=await previousFetch(input,init);
  if(isCharge){
    response.clone().json().then(body=>{
      if(response.ok){
        const data=body?.data;
        const sessionId=data?.result?.session?.id;
        const saleId=data?.result?.sale?.id||data?.result?.saleId||null;
        if(data?.charged&&data?.receiptDecisionRequired&&sessionId){
          pending={sessionId:String(sessionId),saleId:saleId?String(saleId):null,saleNumber:data?.result?.sale?.numero||null,customerName:normalizeCustomerName(data?.customerName),busy:false,nameBusy:false,printed:false};
          setTimeout(renderChoice,0);
        }
      }else{
        setTimeout(()=>showChargeFailure(body,response.status),80);
      }
    }).catch(()=>{
      if(!response.ok)setTimeout(()=>showChargeFailure(null,response.status),80);
    });
  }
  return response;
};

const observer=new MutationObserver(()=>renderChoice());
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
$('#resultDialog')?.addEventListener('close',()=>{
  $('#v19PrintChoice')?.remove();
  const close=$('#resultClose');if(close){close.hidden=false;close.textContent='VOLVER A CAJA'}
  pending=null;
});
})();