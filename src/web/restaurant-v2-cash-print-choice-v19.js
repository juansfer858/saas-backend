/* VANTIX_RESTAURANT_V2_CASH_PRINT_CHOICE_V19 */
(()=>{'use strict';
const MARKER='VANTIX_RESTAURANT_V2_CASH_PRINT_CHOICE_V19';
if(window[MARKER])return;
window[MARKER]=Object.freeze({version:'19.3.0',postSettlement:true,yesNo:true,defaultNoPrint:true,paymentFirst:true,visibleChargeErrors:true,postSaleCustomerReissue:true});
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
    .v19-print-choice>strong{display:block;margin-top:5px;color:#111827;font-size:18px}.v19-print-choice>p{margin:5px 0 0;color:#64748b;font-size:12px;line-height:1.45}
    .v19-reissue-box{margin-top:13px;padding:12px;border:1px solid #f0c36d;border-radius:12px;background:#fffaf0}
    .v19-reissue-box>p{margin:7px 0 0;color:#6b4f16;font-size:11px;line-height:1.45}.v19-reissue-box>p.error{color:#b42318}
    .v19-reissue-btn{width:100%;min-height:43px}.v19-reissue-btn:disabled{opacity:.58;cursor:not-allowed}
    .v19-print-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:13px}.v19-print-actions .rv2-btn{min-height:45px}
    .v19-print-status{margin-top:10px!important;color:#334155!important;font-weight:750}.v19-print-status.error{color:#b42318!important}
    .v19-charge-error,.v19-reissue-dialog{max-width:min(620px,calc(100vw - 30px));border:0;border-radius:16px;padding:0;box-shadow:0 22px 70px rgba(15,23,42,.28)}
    .v19-charge-error::backdrop,.v19-reissue-dialog::backdrop{background:rgba(15,23,42,.52)}
    .v19-charge-error-card,.v19-reissue-card{padding:20px;display:grid;gap:12px;background:#fff;color:#111827}
    .v19-charge-error-card small,.v19-reissue-card>small{font-size:10px;font-weight:850;letter-spacing:.06em;color:#b42318;text-transform:uppercase}
    .v19-charge-error-card strong,.v19-reissue-card>strong{font-size:20px}.v19-charge-error-card p,.v19-reissue-card>p{margin:0;color:#475569;line-height:1.45}
    .v19-charge-error-card code{font-size:11px;color:#64748b;white-space:normal;word-break:break-word}
    .v19-reissue-search{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.v19-reissue-results{display:grid;gap:7px;max-height:210px;overflow:auto}
    .v19-customer-row{display:grid;gap:2px;text-align:left;border:1px solid #dbe3eb;background:#fff;border-radius:10px;padding:10px;cursor:pointer}.v19-customer-row:hover{border-color:#94a3b8}.v19-customer-row small{color:#64748b}
    .v19-create-customer{border-top:1px solid #e5e7eb;padding-top:12px;display:grid;gap:9px}.v19-create-grid{display:grid;grid-template-columns:1fr 1.4fr;gap:8px}.v19-create-grid label{display:grid;gap:4px;color:#475569;font-size:11px;font-weight:800}.v19-create-grid .wide{grid-column:1/-1}
    .v19-dialog-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}.v19-reissue-dialog-status{font-size:12px;color:#475569;min-height:18px}.v19-reissue-dialog-status.error{color:#b42318}
    @media(max-width:520px){.v19-print-actions,.v19-reissue-search,.v19-create-grid{grid-template-columns:1fr}.v19-create-grid .wide{grid-column:auto}.v19-dialog-actions{display:grid}}
  `;
  document.head.appendChild(style);
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

function closeReissueDialog(){
  const dialog=$('#v19CustomerReissueDialog');
  if(dialog?.open)dialog.close();else dialog?.remove();
}

function finishWithoutPrint(){
  closeReissueDialog();
  pending=null;
  $('#v19PrintChoice')?.remove();
  const close=$('#resultClose');if(close)close.hidden=false;
  $('#resultDialog')?.close();
}

function reissueUiStatus(text,error=false){
  const node=$('[data-v19-reissue-status]',$('#v19PrintChoice'));
  if(node){node.textContent=text||'';node.classList.toggle('error',Boolean(error))}
}

async function loadReissueContext(){
  if(!pending?.saleId)return null;
  const box=$('[data-v19-reissue-box]',$('#v19PrintChoice'));
  const button=$('[data-v19-reissue]',$('#v19PrintChoice'));
  if(!box||!button)return null;
  try{
    const data=await RV2.api(`/api/v1/restaurante/v2/caja/ventas/${encodeURIComponent(pending.saleId)}/recrear-cliente`);
    pending.reissueContext=data;
    if(data?.alreadyReissued&&data?.replacement?.id){
      pending.saleId=String(data.replacement.id);
      pending.saleNumber=data.replacement.numero||pending.saleNumber;
      pending.customer=data.customer||pending.customer;
      box.hidden=true;
      return data;
    }
    if(data?.eligible){
      box.hidden=false;button.disabled=false;
      reissueUiStatus('Si el cliente necesita factura a su nombre, identifica el cliente antes de imprimir.');
    }else if(['CUSTOMER_ALREADY_IDENTIFIED','CREDIT_NOT_SUPPORTED'].includes(String(data?.blockedReason||''))){
      box.hidden=true;
    }else{
      box.hidden=false;button.disabled=true;
      reissueUiStatus(data?.blockedMessage||'Esta venta no admite recreación automática.',true);
    }
    return data;
  }catch(error){
    box.hidden=false;button.disabled=true;
    reissueUiStatus(error.message||'No fue posible validar si la venta puede recrearse.',true);
    return null;
  }
}

function dialogStatus(dialog,text,error=false){
  const node=$('[data-v19-dialog-status]',dialog);
  if(node){node.textContent=text||'';node.classList.toggle('error',Boolean(error))}
}

function customerName(customer){return String(customer?.razonSocial||customer?.nombre||'Cliente').trim()}

function renderCustomerResults(dialog,customers){
  const root=$('[data-v19-customer-results]',dialog);if(!root)return;
  root.innerHTML=(customers||[]).map(customer=>`<button type="button" class="v19-customer-row" data-v19-customer="${RV2.esc(customer.id)}"><b>${RV2.esc(customerName(customer))}</b><small>${RV2.esc(customer.tipoDocumento||'DOC')} ${RV2.esc(customer.identificacion||'')} ${customer.telefono?`· ${RV2.esc(customer.telefono)}`:''}</small></button>`).join('')||'<div class="rv2-muted">No hay clientes que coincidan.</div>';
  root.querySelectorAll('[data-v19-customer]').forEach(button=>button.onclick=()=>{
    const customer=(customers||[]).find(row=>String(row.id)===String(button.dataset.v19Customer));
    if(customer)confirmCustomerReissue(dialog,customer);
  });
}

async function searchCustomers(dialog,q=''){
  try{
    dialogStatus(dialog,'Buscando clientes…');
    const customers=await RV2.api(`/api/v1/restaurante/v2/caja/clientes?q=${encodeURIComponent(q||'')}`);
    renderCustomerResults(dialog,customers||[]);
    dialogStatus(dialog,'Selecciona un cliente existente o crea uno nuevo.');
  }catch(error){dialogStatus(dialog,error.message||'No fue posible buscar clientes.',true)}
}

async function confirmCustomerReissue(dialog,customer){
  if(!pending?.saleId||pending.reissueBusy)return;
  const label=customerName(customer);
  const ok=confirm(`La venta ${pending.saleNumber||''} quedará ANULADA y se creará una nueva a nombre de ${label} (${customer.identificacion||'sin documento visible'}). Los productos y el valor deben quedar iguales. ¿Continuar?`);
  if(!ok)return;
  pending.reissueBusy=true;
  dialogStatus(dialog,'Anulando la venta original y creando la nueva…');
  dialog.querySelectorAll('button,input,select').forEach(node=>node.disabled=true);
  try{
    const data=await RV2.api(`/api/v1/restaurante/v2/caja/ventas/${encodeURIComponent(pending.saleId)}/recrear-cliente`,{method:'POST',body:JSON.stringify({terceroId:customer.id})});
    if(!data?.replacement?.id)throw new Error('El servidor no confirmó la venta reemplazo');
    const oldNumber=pending.saleNumber;
    pending.saleId=String(data.replacement.id);
    pending.saleNumber=data.replacement.numero||pending.saleNumber;
    pending.customer=data.customer||customer;
    pending.reissueContext={eligible:false,alreadyReissued:true,replacement:data.replacement,customer:pending.customer};
    const title=$('#resultTitle');if(title)title.textContent=`${pending.saleNumber} · ${customerName(pending.customer)}`;
    const button=$('[data-v19-reissue]',$('#v19PrintChoice'));if(button)button.hidden=true;
    reissueUiStatus(`Venta ${oldNumber||'original'} anulada. Nueva venta ${pending.saleNumber} creada con ${customerName(pending.customer)}.`);
    dialogStatus(dialog,'Venta recreada correctamente.');
    setTimeout(()=>{if(dialog.open)dialog.close()},250);
  }catch(error){
    dialogStatus(dialog,error.message||'No fue posible anular y recrear la venta.',true);
    dialog.querySelectorAll('button,input,select').forEach(node=>node.disabled=false);
  }finally{pending.reissueBusy=false}
}

async function createCustomerAndReissue(event,dialog){
  event.preventDefault();
  if(pending?.reissueBusy)return;
  const fd=new FormData(event.currentTarget);
  const payload={};for(const [key,value] of fd.entries())payload[key]=typeof value==='string'?value.trim():value;
  for(const key of ['telefono','email','direccion'])if(!payload[key])payload[key]=null;
  try{
    dialogStatus(dialog,'Creando cliente…');
    const customer=await RV2.api('/api/v1/restaurante/v2/caja/clientes',{method:'POST',body:JSON.stringify(payload)});
    await confirmCustomerReissue(dialog,customer);
  }catch(error){dialogStatus(dialog,error.message||'No fue posible crear el cliente.',true)}
}

async function openCustomerReissue(){
  if(!pending?.saleId||pending.reissueBusy)return;
  const context=await loadReissueContext();
  if(!context?.eligible){
    reissueUiStatus(context?.blockedMessage||'Esta venta no se puede recrear automáticamente.',true);
    return;
  }
  closeReissueDialog();
  const dialog=document.createElement('dialog');
  dialog.id='v19CustomerReissueDialog';dialog.className='v19-reissue-dialog';
  dialog.innerHTML='<div class="v19-reissue-card"><small>ANULAR Y RECREAR</small><strong>Identificar cliente</strong><p>La venta original conservará su historial como ANULADA. Se generará una nueva venta con los mismos productos, valores y medio de pago, vinculada al cliente seleccionado.</p><div class="v19-reissue-search"><input class="rv2-input" type="search" placeholder="Nombre, documento o teléfono…" data-v19-customer-search><button type="button" class="rv2-btn" data-v19-search>BUSCAR</button></div><div class="v19-reissue-results" data-v19-customer-results></div><div class="v19-create-customer"><b>Crear cliente nuevo</b><form data-v19-create-form><div class="v19-create-grid"><label>Tipo de documento<select class="rv2-input" name="tipoDocumento"><option value="CC">CC</option><option value="NIT">NIT</option><option value="CE">CE</option><option value="PASAPORTE">Pasaporte</option></select></label><label>Identificación<input class="rv2-input" name="identificacion" minlength="3" maxlength="40" required></label><label class="wide">Nombre / razón social<input class="rv2-input" name="nombre" minlength="2" maxlength="160" required></label><label>Teléfono<input class="rv2-input" name="telefono" maxlength="50"></label><label>Correo<input class="rv2-input" name="email" type="email" maxlength="254"></label><label class="wide">Dirección<input class="rv2-input" name="direccion" maxlength="250"></label></div><div class="v19-dialog-actions"><button type="submit" class="rv2-btn rv2-btn-primary">CREAR Y USAR CLIENTE</button></div></form></div><div class="v19-reissue-dialog-status" data-v19-dialog-status></div><div class="v19-dialog-actions"><button type="button" class="rv2-btn" data-v19-cancel>CERRAR</button></div></div>';
  $('[data-v19-cancel]',dialog).onclick=()=>dialog.close();
  $('[data-v19-search]',dialog).onclick=()=>searchCustomers(dialog,$('[data-v19-customer-search]',dialog).value);
  $('[data-v19-customer-search]',dialog).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();searchCustomers(dialog,event.currentTarget.value)}});
  $('[data-v19-create-form]',dialog).addEventListener('submit',event=>createCustomerAndReissue(event,dialog));
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.appendChild(dialog);dialog.showModal();
  await searchCustomers(dialog,'');
}

async function requestPrint(){
  if(!pending?.sessionId||pending.busy)return;
  pending.busy=true;
  const root=$('#v19PrintChoice');
  const yes=$('[data-v19-print-yes]',root);const no=$('[data-v19-print-no]',root);const reissue=$('[data-v19-reissue]',root);const status=$('[data-v19-print-status]',root);
  if(yes)yes.disabled=true;if(no)no.disabled=true;if(reissue)reissue.disabled=true;
  if(status){status.textContent='Enviando recibo a impresión…';status.classList.remove('error')}
  try{
    const data=await RV2.api('/api/v1/restaurante/v2/caja/recibo/imprimir',{method:'POST',body:JSON.stringify({sessionId:pending.sessionId})});
    if(!data?.receiptRequested)throw new Error('La cola de impresión no confirmó el recibo');
    if(status)status.textContent='Recibo enviado a la cola de impresión.';
    const close=$('#resultClose');if(close){close.hidden=false;close.textContent='VOLVER A CAJA'}
    if(yes)yes.hidden=true;if(no)no.hidden=true;if(reissue)reissue.hidden=true;
    pending.printed=true;
  }catch(error){
    pending.busy=false;
    if(status){status.textContent=`La venta está liquidada, pero no se pudo enviar el recibo: ${error.message||'error de impresión'}.`;status.classList.add('error')}
    if(yes){yes.disabled=false;yes.textContent='REINTENTAR IMPRESIÓN'}
    if(no){no.disabled=false;no.textContent='NO IMPRIMIR'}
    if(reissue&&pending.reissueContext?.eligible)reissue.disabled=false;
  }
}

function renderChoice(){
  if(rendering||!pending?.sessionId)return;
  const dialog=$('#resultDialog');if(!dialog?.open)return;
  if($('#v19PrintChoice'))return;
  rendering=true;
  try{
    ensureStyle();cleanResultText();
    const close=$('#resultClose');if(close)close.hidden=true;
    const root=document.createElement('section');
    root.id='v19PrintChoice';root.className='v19-print-choice';
    root.innerHTML='<small>VENTA LIQUIDADA</small><strong>Factura / recibo creado</strong><p>La venta ya quedó registrada. Para cambiar el cliente no se edita el documento: se anula y se crea uno nuevo con trazabilidad completa.</p><div class="v19-reissue-box" data-v19-reissue-box hidden><button type="button" class="rv2-btn v19-reissue-btn" data-v19-reissue disabled>IDENTIFICAR CLIENTE (ANULAR Y RECREAR)</button><p data-v19-reissue-status></p></div><div class="v19-print-actions"><button type="button" class="rv2-btn rv2-btn-primary" data-v19-print-yes>SÍ, IMPRIMIR</button><button type="button" class="rv2-btn" data-v19-print-no>NO</button></div><p class="v19-print-status" data-v19-print-status></p>';
    close?.insertAdjacentElement('beforebegin',root);
    $('[data-v19-reissue]',root).onclick=openCustomerReissue;
    $('[data-v19-print-yes]',root).onclick=requestPrint;
    $('[data-v19-print-no]',root).onclick=finishWithoutPrint;
    if(pending.saleId)setTimeout(loadReissueContext,0);
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
          pending={sessionId:String(sessionId),saleId:saleId?String(saleId):null,saleNumber:data?.result?.sale?.numero||null,customer:data?.customer||null,busy:false,reissueBusy:false,printed:false,reissueContext:null};
          setTimeout(renderChoice,0);
        }
      }else setTimeout(()=>showChargeFailure(body,response.status),80);
    }).catch(()=>{if(!response.ok)setTimeout(()=>showChargeFailure(null,response.status),80)});
  }
  return response;
};

const observer=new MutationObserver(()=>renderChoice());
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
$('#resultDialog')?.addEventListener('close',()=>{
  closeReissueDialog();$('#v19PrintChoice')?.remove();
  const close=$('#resultClose');if(close){close.hidden=false;close.textContent='VOLVER A CAJA'}
  pending=null;
});
})();