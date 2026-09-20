/* VANTIX_DEMO_RESTAURANTE_ORDERS_POS_V1 */
(()=>{'use strict';
const MARKER='VANTIX_DEMO_RESTAURANTE_ORDERS_POS_V1';
const TENANT='demo-restaurante';
const RV2=window.RestaurantV2;
if(!RV2)return;
const session=RV2.readSession?.()||RV2.requireSession?.();
if(String(session?.subdomain||'').trim().toLowerCase()!==TENANT)return;

document.body.dataset.demoOrdersPos='1';
document.documentElement.dataset.demoOrdersPos=MARKER;

const cash={
  workspace:null,detail:null,methodId:null,customerId:null,customers:[],busy:false,tableId:null
};
let applying=false;
let scheduled=false;
const $=(q,root=document)=>root.querySelector(q);
const $$=(q,root=document)=>[...root.querySelectorAll(q)];

function selectedTableButton(){return $('.table-chip.active')}
function selectedTableId(){return selectedTableButton()?.dataset?.table||null}
function selectedTableIsOpen(){return Boolean(selectedTableButton()?.classList.contains('occupied'))}
function selectedTableName(){return selectedTableButton()?.childNodes?.[0]?.textContent?.trim()||$('#draftTitle')?.textContent||'Mesa'}
function money(value){return RV2.money(value||0)}
function showNotice(text,error=false){
  const n=$('#notice');
  if(n){n.textContent=text;n.classList.toggle('error',Boolean(error))}
}

function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{scheduled=false;apply()});
}

function ensurePanelTitles(){
  const tablesPanel=$('.tables-panel');
  if(tablesPanel&&!tablesPanel.querySelector('[data-demo-panel-title]')){
    const title=document.createElement('div');
    title.className='demo-panel-title';
    title.dataset.demoPanelTitle='locations';
    title.innerHTML='<small>UBICACIONES</small><b>Mesas</b>';
    tablesPanel.prepend(title);
  }
}

function ensureMenuLayout(){
  const menuPanel=$('.menu-panel');
  const categories=$('#categories');
  const menuHead=$('.menu-head');
  if(!menuPanel||!categories||!menuHead)return;
  if(categories.previousElementSibling!==null&&categories.parentElement===menuPanel){
    menuPanel.prepend(categories);
  }else if(categories.parentElement!==menuPanel){
    menuPanel.prepend(categories);
  }
  const h2=menuHead.querySelector('h2');
  if(h2)h2.textContent='Agregar productos';
  const search=$('#search');
  if(search)search.placeholder='Buscar producto por nombre o código…';
}

function ensureDraftLayout(){
  const panel=$('.draft-panel');
  const service=$('#serviceControls');
  const head=$('.draft-head');
  const review=$('#review');
  if(!panel||!head||!review)return;

  let summary=panel.querySelector('[data-demo-table-summary]');
  if(!summary){
    summary=document.createElement('section');
    summary.className='demo-table-summary';
    summary.dataset.demoTableSummary='1';
    summary.innerHTML='<small>MESA SELECCIONADA</small><strong data-demo-table-name>Sin mesa</strong><span data-demo-table-state>Selecciona una mesa para comenzar.</span>';
    panel.prepend(summary);
  }

  let serviceSlot=panel.querySelector('[data-demo-service-slot]');
  if(!serviceSlot){
    serviceSlot=document.createElement('div');
    serviceSlot.className='demo-service-slot';
    serviceSlot.dataset.demoServiceSlot='1';
    head.insertAdjacentElement('afterend',serviceSlot);
  }
  if(service&&service.parentElement!==serviceSlot)serviceSlot.appendChild(service);

  let actions=panel.querySelector('[data-demo-order-actions]');
  if(!actions){
    actions=document.createElement('div');
    actions.className='demo-order-actions';
    actions.dataset.demoOrderActions='1';
    actions.innerHTML='<button type="button" class="rv2-btn" data-demo-split>Separar cuenta</button><button type="button" class="rv2-btn" data-demo-prebill>Precuenta</button><button type="button" class="rv2-btn rv2-btn-primary" data-demo-send>Enviar pedido</button><button type="button" class="rv2-btn" data-demo-cash>Cobrar</button>';
    panel.appendChild(actions);
    actions.querySelector('[data-demo-send]').onclick=sendCurrentOrderDirect;
    actions.querySelector('[data-demo-prebill]').onclick=requestAccount;
    actions.querySelector('[data-demo-split]').onclick=openSplit;
    actions.querySelector('[data-demo-cash]').onclick=openCash;
  }
  const tableName=summary.querySelector('[data-demo-table-name]');
  const tableState=summary.querySelector('[data-demo-table-state]');
  if(tableName)tableName.textContent=selectedTableName();
  const button=selectedTableButton();
  if(tableState)tableState.textContent=button?button.querySelector('small')?.textContent||'Mesa seleccionada':'Selecciona una mesa para comenzar.';

  const send=actions.querySelector('[data-demo-send]');
  const prebill=actions.querySelector('[data-demo-prebill]');
  const split=actions.querySelector('[data-demo-split]');
  const charge=actions.querySelector('[data-demo-cash]');
  if(send)send.disabled=Boolean(review.disabled);
  const open=selectedTableIsOpen();
  if(prebill)prebill.disabled=!open;
  if(split)split.disabled=!open;
  if(charge)charge.disabled=!open;
}

function enhanceMenuClick(){
  if(document.body.dataset.demoMenuDelegated==='1')return;
  document.body.dataset.demoMenuDelegated='1';
  document.addEventListener('click',(event)=>{
    const card=event.target.closest?.('.menu-item');
    if(!card||event.target.closest('button,input,textarea,select,a'))return;
    const button=card.querySelector('[data-add]:not(:disabled)');
    if(button)button.click();
  });
}

function apply(){
  if(applying)return;
  applying=true;
  try{
    ensurePanelTitles();
    ensureMenuLayout();
    ensureDraftLayout();
    enhanceMenuClick();
    const headerTitle=$('.rv2-order-top h1');
    if(headerTitle)headerTitle.textContent='Pedidos';
    const tenantLine=$('#tenantLine');
    if(tenantLine&&session?.tenant?.nombreEmpresa)tenantLine.textContent=session.tenant.nombreEmpresa+' · Pedidos + Caja';
  }finally{applying=false}
}

async function sendCurrentOrderDirect(){
  const tableId=selectedTableId();
  const review=$('#review');
  if(!tableId||!selectedTableIsOpen()||!review||review.disabled)return;
  const button=$('[data-demo-send]');
  if(button){button.disabled=true;button.textContent='Enviando…'}
  try{
    const tables=await RV2.api('/api/v1/restaurante/v2/mesas');
    const table=(tables||[]).find(row=>String(row.id)===String(tableId));
    const sessionId=table?.activeSession?.id;
    if(!sessionId)throw new Error('La mesa ya no tiene una sesión activa.');
    await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(sessionId)+'/pedido/enviar',{method:'POST',body:'{}'});
    showNotice('Pedido enviado a producción.');
    $('#refresh')?.click();
  }catch(error){
    showNotice(error.message||'No fue posible enviar el pedido.',true);
  }finally{
    if(button){button.disabled=false;button.textContent='Enviar pedido'}
  }
}

async function requestAccount(){
  const tableId=selectedTableId();
  if(!tableId||!selectedTableIsOpen())return;
  const review=$('#review');
  if(review&&!review.disabled){
    showNotice('Hay productos sin enviar. Envía el pedido antes de pedir la cuenta.',true);
    return;
  }
  try{
    await RV2.api('/api/v1/restaurante/v2/mesas/'+encodeURIComponent(tableId)+'/pedir-cuenta',{method:'POST',body:'{}'});
    showNotice('Precuenta solicitada. La mesa quedó lista para Caja.');
    $('#refresh')?.click();
  }catch(error){showNotice(error.message||'No fue posible preparar la cuenta.',true)}
}

function openSplit(){
  const tableId=selectedTableId();
  if(!tableId||!selectedTableIsOpen())return;
  location.assign('/app/restaurante-v2/division?tableId='+encodeURIComponent(tableId));
}

function ensureCashDialog(){
  let dialog=$('#demoOrdersCashDialog');
  if(dialog)return dialog;
  dialog=document.createElement('dialog');
  dialog.id='demoOrdersCashDialog';
  dialog.className='demo-pos-cash-dialog';
  dialog.innerHTML='<div class="demo-pos-cash-shell"><div class="demo-pos-cash-head"><div><small>PEDIDOS · CAJA INTEGRADA</small><h2 data-demo-cash-title>Cobrar mesa</h2></div><div><div class="demo-pos-cash-total" data-demo-cash-total>$0</div><button type="button" class="rv2-btn" data-demo-cash-close>Cerrar</button></div></div><div class="demo-pos-cash-body" data-demo-cash-body></div></div>';
  document.body.appendChild(dialog);
  dialog.querySelector('[data-demo-cash-close]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>resetCashState());
  return dialog;
}

function resetCashState(){
  cash.workspace=null;cash.detail=null;cash.methodId=null;cash.customerId=null;cash.customers=[];cash.busy=false;cash.tableId=null;
}

function methodLabel(kind){
  return kind==='EFECTIVO'?'Efectivo':kind==='TRANSFERENCIA'?'Transferencia / QR':kind==='TARJETA'?'Tarjeta':kind==='CREDITO'?'Crédito':kind||'Método';
}

function selectedMethod(){return cash.detail?.paymentMethods?.find(x=>String(x.id)===String(cash.methodId))||null}
function selectedCustomer(){return cash.customers.find(x=>String(x.id)===String(cash.customerId))||null}

function cashStatus(text,error=false){
  const node=$('[data-demo-cash-status]',$('#demoOrdersCashDialog'));
  if(node){node.textContent=text||'';node.classList.toggle('error',Boolean(error))}
}

async function openCash(){
  const tableId=selectedTableId();
  if(!tableId||!selectedTableIsOpen())return;
  const review=$('#review');
  if(review&&!review.disabled){
    showNotice('Hay productos sin enviar. Envía el pedido antes de cobrar.',true);
    return;
  }
  const dialog=ensureCashDialog();
  cash.tableId=tableId;
  dialog.showModal();
  const body=$('[data-demo-cash-body]',dialog);
  body.innerHTML='<div class="rv2-muted">Cargando Caja…</div>';
  try{
    const [workspace,detail]=await Promise.all([
      RV2.api('/api/v1/restaurante/v2/caja'),
      RV2.api('/api/v1/restaurante/v2/caja/mesas/'+encodeURIComponent(tableId))
    ]);
    cash.workspace=workspace;
    cash.detail=detail;
    cash.methodId=detail.paymentMethods?.[0]?.id||null;
    renderCash();
  }catch(error){
    body.innerHTML='<div class="notice error">'+RV2.esc(error.message||'No fue posible abrir Caja desde Pedidos.')+'</div>';
  }
}

function renderCash(){
  const dialog=$('#demoOrdersCashDialog');
  if(!dialog||!cash.detail)return;
  const detail=cash.detail;
  $('[data-demo-cash-title]',dialog).textContent=(detail.table?.name||'Mesa')+' · '+(detail.sale?.numero||'Cuenta');
  $('[data-demo-cash-total]',dialog).textContent=money(detail.sale?.total||0);
  const body=$('[data-demo-cash-body]',dialog);

  if(detail.session?.requiresP5){
    body.innerHTML='<div class="demo-pos-shift-warning"><b>Esta cuenta requiere División.</b><p>Usa el módulo de División para cobrar las partes sin alterar la cuenta.</p><button type="button" class="rv2-btn rv2-btn-primary" data-demo-open-split>ABRIR DIVISIÓN</button></div>';
    body.querySelector('[data-demo-open-split]').onclick=openSplit;
    return;
  }

  if(!cash.workspace?.shift?.own){
    const accounts=cash.workspace?.shift?.cashAccounts||[];
    body.innerHTML='<div class="demo-pos-shift-warning"><b>Turno de Caja cerrado</b><p>Abre tu turno para cobrar desde Pedidos.</p><div class="demo-pos-shift-grid"><label>Caja<select class="rv2-input" data-demo-cash-account>'+accounts.map(a=>'<option value="'+RV2.esc(a.id)+'">'+RV2.esc(a.nombre)+'</option>').join('')+'</select></label><label>Base inicial<input class="rv2-input" data-demo-initial type="number" min="0" step="100" value="0"></label></div><button type="button" class="rv2-btn rv2-btn-primary" data-demo-open-shift '+(accounts.length?'':'disabled')+'>ABRIR TURNO</button></div><div class="demo-pos-cash-status" data-demo-cash-status></div>';
    body.querySelector('[data-demo-open-shift]')?.addEventListener('click',openShift);
    return;
  }

  const methods=detail.paymentMethods||[];
  if(!methods.some(x=>String(x.id)===String(cash.methodId)))cash.methodId=methods[0]?.id||null;
  const method=selectedMethod();
  const credit=method?.kind==='CREDITO';

  body.innerHTML='<section><small>MÉTODO DE PAGO</small><div class="demo-pos-payment-methods">'+methods.map(m=>'<button type="button" class="demo-pos-method '+(String(m.id)===String(cash.methodId)?'active':'')+'" data-demo-method="'+RV2.esc(m.id)+'"><b>'+RV2.esc(m.name)+'</b><span>'+RV2.esc(methodLabel(m.kind))+(m.account?.nombre?' · '+RV2.esc(m.account.nombre):'')+'</span></button>').join('')+'</div></section>'+
  '<div class="demo-pos-payment-fields"><label>Nombre en recibo<input class="rv2-input" data-demo-customer-name maxlength="160" value="Cliente genérico"></label><label>Propina<input class="rv2-input" data-demo-tip type="number" min="0" step="100" value="0" '+(credit?'disabled':'')+'></label><label style="grid-column:1/-1">Referencia / comprobante<input class="rv2-input" data-demo-reference maxlength="160" placeholder="Opcional"></label></div>'+
  '<section data-demo-credit-box '+(credit?'':'hidden')+'><b>Cliente para crédito</b><input class="rv2-input" data-demo-customer-search placeholder="Buscar cliente…"><div class="demo-pos-customer-results" data-demo-customers></div></section>'+
  '<button type="button" class="rv2-btn rv2-btn-primary" data-demo-charge>COBRAR '+money(detail.sale?.total||0)+'</button><div class="demo-pos-cash-status" data-demo-cash-status></div>';

  $$('[data-demo-method]',body).forEach(btn=>btn.onclick=()=>{cash.methodId=btn.dataset.demoMethod;cash.customerId=null;cash.customers=[];renderCash()});
  body.querySelector('[data-demo-charge]').onclick=charge;
  const search=body.querySelector('[data-demo-customer-search]');
  if(search){
    search.oninput=()=>scheduleCustomerSearch(search.value);
    loadCustomers('');
  }
}

async function openShift(){
  if(cash.busy)return;
  const dialog=$('#demoOrdersCashDialog');
  const account=dialog.querySelector('[data-demo-cash-account]')?.value;
  const initial=Number(dialog.querySelector('[data-demo-initial]')?.value||0);
  if(!account)return;
  cash.busy=true;
  cashStatus('Abriendo turno…');
  try{
    await RV2.api('/api/v1/restaurante/v2/caja/turno/abrir',{method:'POST',body:JSON.stringify({cajaBancoId:account,saldoInicial:initial})});
    cash.workspace=await RV2.api('/api/v1/restaurante/v2/caja');
    cash.detail=await RV2.api('/api/v1/restaurante/v2/caja/mesas/'+encodeURIComponent(cash.tableId));
    cash.methodId=cash.detail.paymentMethods?.[0]?.id||null;
    renderCash();
  }catch(error){cashStatus(error.message||'No fue posible abrir el turno.',true)}
  finally{cash.busy=false}
}

let customerTimer=null;
function scheduleCustomerSearch(q){
  clearTimeout(customerTimer);
  customerTimer=setTimeout(()=>loadCustomers(q),180);
}

async function loadCustomers(q){
  if(!selectedMethod()||selectedMethod().kind!=='CREDITO')return;
  try{
    cash.customers=await RV2.api('/api/v1/restaurante/v2/caja/clientes?q='+encodeURIComponent(q||''));
    renderCustomers();
  }catch(error){cashStatus(error.message||'No fue posible buscar clientes.',true)}
}

function renderCustomers(){
  const root=$('[data-demo-customers]',$('#demoOrdersCashDialog'));
  if(!root)return;
  root.innerHTML=(cash.customers||[]).slice(0,30).map(c=>'<button type="button" class="demo-pos-customer '+(String(c.id)===String(cash.customerId)?'active':'')+'" data-demo-customer="'+RV2.esc(c.id)+'"><b>'+RV2.esc(c.nombre||c.razonSocial||'Cliente')+'</b><small>'+RV2.esc(c.identificacion||'')+'</small></button>').join('')||'<div class="rv2-muted">No hay clientes que coincidan.</div>';
  $$('[data-demo-customer]',root).forEach(btn=>btn.onclick=()=>{cash.customerId=btn.dataset.demoCustomer;renderCustomers()});
}

async function charge(){
  const method=selectedMethod();
  const dialog=$('#demoOrdersCashDialog');
  if(!cash.detail||!method||cash.busy)return;
  if(method.kind==='CREDITO'&&!cash.customerId){cashStatus('Selecciona un cliente para crédito.',true);return}
  const total=money(cash.detail.sale?.total||0);
  if(!confirm('Cobrar '+total+' con '+method.name+'?'))return;
  const body=dialog.querySelector('[data-demo-cash-body]');
  const customerName=body.querySelector('[data-demo-customer-name]')?.value?.trim()||'Cliente genérico';
  const tip=Number(body.querySelector('[data-demo-tip]')?.value||0);
  const reference=body.querySelector('[data-demo-reference]')?.value?.trim()||null;
  cash.busy=true;
  body.querySelector('[data-demo-charge]').disabled=true;
  cashStatus('Registrando cobro…');
  try{
    const data=await RV2.api('/api/v1/restaurante/v2/caja/mesas/'+encodeURIComponent(cash.tableId)+'/cobrar',{method:'POST',body:JSON.stringify({paymentMethodId:method.id,tipAmount:tip,reference,terceroId:method.kind==='CREDITO'?cash.customerId:null,customerName})});
    renderCashResult(data);
    $('#refresh')?.click();
  }catch(error){
    cashStatus(error.message||'No fue posible realizar el cobro.',true);
    const btn=body.querySelector('[data-demo-charge]');if(btn)btn.disabled=false;
  }finally{cash.busy=false}
}

function renderCashResult(data){
  const dialog=$('#demoOrdersCashDialog');
  const body=$('[data-demo-cash-body]',dialog);
  const sessionId=data?.result?.session?.id||null;
  const saleNumber=data?.result?.sale?.numero||'POS';
  body.innerHTML='<div class="demo-pos-cash-result"><small>VENTA LIQUIDADA</small><strong>'+RV2.esc(saleNumber)+'</strong><p>El cobro quedó registrado. ¿Deseas imprimir el recibo?</p><div class="demo-pos-print-actions"><button type="button" class="rv2-btn rv2-btn-primary" data-demo-print>SÍ, IMPRIMIR</button><button type="button" class="rv2-btn" data-demo-no-print>NO</button></div><div class="demo-pos-cash-status" data-demo-cash-status></div></div>';
  const print=body.querySelector('[data-demo-print]');
  const no=body.querySelector('[data-demo-no-print]');
  if(print)print.onclick=()=>printReceipt(sessionId);
  if(no)no.onclick=()=>finishCash();
}

async function printReceipt(sessionId){
  if(!sessionId){cashStatus('No se recibió la sesión liquidada para imprimir.',true);return}
  cashStatus('Enviando recibo a impresión…');
  try{
    await RV2.api('/api/v1/restaurante/v2/caja/recibo/imprimir',{method:'POST',body:JSON.stringify({sessionId})});
    cashStatus('Recibo enviado a la cola de impresión.');
    setTimeout(finishCash,450);
  }catch(error){cashStatus('La venta quedó liquidada, pero no se pudo imprimir: '+(error.message||'error'),true)}
}

function finishCash(){
  $('#demoOrdersCashDialog')?.close();
  $('#refresh')?.click();
  showNotice('Cobro registrado. Mesa actualizada.');
}

const observer=new MutationObserver(schedule);
function start(){
  apply();
  observer.observe(document.body,{subtree:true,childList:true});
  window.addEventListener('vantix:tenant-realtime',schedule);
  window.addEventListener('pageshow',schedule);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.VantixDemoRestaurantOrdersPosV1=Object.freeze({marker:MARKER,version:'2.0.0',tenant:TENANT,refresh:schedule,openCash,sendCurrentOrderDirect});
})();