/* VANTIX_RESTAURANT_INVENTORY_BAR_V1 */
(()=>{'use strict';
const V=window.RestaurantV2;if(!V)throw new Error('Restaurant V2 SDK no disponible');
const session=V.requireSession();
if(String(session?.subdomain||'').trim().toLowerCase()!=='demo-restaurante'){location.replace('/app/centro-de-control-v2');return}
const $=(q,r=document)=>r.querySelector(q);
const $$=(q,r=document)=>[...r.querySelectorAll(q)];
const esc=V.esc;
const money=V.money;
const S={workspace:null,purchases:[],history:[],historyNext:null,tab:'stock',purchaseLines:0};

function notice(text,error=false){const n=$('#notice');if(!n)return;n.textContent=text||'';n.classList.toggle('error',error);n.hidden=!text}
function err(id,text=''){const n=$(id);if(!n)return;n.textContent=text||'';n.hidden=!text}
function num(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
function q(v){return new Intl.NumberFormat('es-CO',{maximumFractionDigits:4}).format(num(v))}
function dateText(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short'}).format(d)}
function dateOnly(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeZone:'UTC'}).format(d)}
function today(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s}
function downloadCsv(name,headers,rows){const body=[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');const blob=new Blob(['\ufeff'+body],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0)}

function controlled(){return (S.workspace?.products||[]).filter(p=>p.enabled)}
function product(id){return (S.workspace?.products||[]).find(p=>p.productId===id)||null}
function enabledProducts(){return controlled().filter(p=>p.active)}
function statusOf(p){if(!p.enabled)return['Sin control','off'];if(p.available<=0)return['Agotado','out'];if(p.available<=p.minimum)return['Bajo mínimo','low'];return['Disponible','']}
function renderMetrics(){
  const m=S.workspace?.metrics||{};
  $('#metrics').innerHTML=[
    ['Productos controlados',m.controlled||0,'Afecta inventario activo'],
    ['Bajo mínimo',m.low||0,'requieren revisión'],
    ['Agotados',m.out||0,'disponible en cero'],
    ['Con reservas',m.reserved||0,'pedidos enviados']
  ].map(x=>'<article class="inv-metric"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b><small>'+esc(x[2])+'</small></article>').join('');
}
function filteredProducts(){
  const query=String($('#stockSearch')?.value||'').trim().toLowerCase(),filter=$('#stockFilter')?.value||'ALL';
  return (S.workspace?.products||[]).filter(p=>{
    const text=(p.sku+' '+p.name+' '+p.category+' '+p.station).toLowerCase();
    if(query&&!text.includes(query))return false;
    if(filter==='CONTROLLED'&&!p.enabled)return false;
    if(filter==='LOW'&&(!p.enabled||p.available>p.minimum))return false;
    if(filter==='OUT'&&(!p.enabled||p.available>0))return false;
    if(filter==='RESERVED'&&(!p.enabled||p.reserved<=0))return false;
    return true;
  });
}
function actionHtml(p){
  const track='<label class="inv-track"><input type="checkbox" data-track="'+esc(p.productId)+'" '+(p.enabled?'checked':'')+' '+(p.recipe?'disabled title="Este producto usa receta"':'')+'> Afecta inventario</label>';
  const buttons=p.enabled
    ? '<button class="rv2-btn" type="button" data-move="'+esc(p.productId)+'">Movimiento</button><button class="rv2-btn" type="button" data-minimum="'+esc(p.productId)+'">Mínimo</button><button class="rv2-btn" type="button" data-cost="'+esc(p.productId)+'">Costos</button>'
    : '';
  return '<div class="inv-row-actions">'+track+buttons+'</div>';
}
function renderStock(){
  const rows=filteredProducts();
  $('#stockRows').innerHTML=rows.length?rows.map(p=>{
    const st=statusOf(p);
    return '<tr><td class="inv-product"><b>'+esc(p.name)+'</b><span>'+esc(p.sku)+' · '+esc(p.category)+' · '+esc(p.station)+(p.recipe?' · Receta':'')+'</span></td>'+
      '<td class="inv-num">'+(p.enabled?q(p.onHand):'—')+'</td><td class="inv-num inv-reserved">'+(p.enabled?q(p.reserved):'—')+'</td>'+
      '<td class="inv-num '+(p.enabled&&p.available<=0?'inv-out':p.enabled&&p.available<=p.minimum?'inv-low':'inv-ok')+'">'+(p.enabled?q(p.available):'—')+'</td>'+
      '<td class="inv-num">'+(p.enabled?q(p.minimum):'—')+'</td><td><span class="inv-status '+st[1]+'">'+esc(st[0])+'</span></td><td>'+actionHtml(p)+'</td></tr>';
  }).join(''):'<tr><td colspan="7"><div class="inv-empty">No hay productos para este filtro.</div></td></tr>';
  $('#stockCards').innerHTML=rows.length?rows.map(p=>{
    const st=statusOf(p);
    return '<article class="inv-stock-card"><div><h3>'+esc(p.name)+'</h3><small>'+esc(p.sku)+' · '+esc(p.category)+'</small></div>'+
      '<div class="inv-stock-grid"><div class="inv-stock-kpi"><small>Saldo</small><b>'+(p.enabled?q(p.onHand):'—')+'</b></div><div class="inv-stock-kpi"><small>Reservado</small><b>'+(p.enabled?q(p.reserved):'—')+'</b></div><div class="inv-stock-kpi"><small>Disponible</small><b>'+(p.enabled?q(p.available):'—')+'</b></div></div>'+
      '<span class="inv-status '+st[1]+'">'+esc(st[0])+'</span>'+actionHtml(p)+'</article>';
  }).join(''):'<div class="inv-empty">No hay productos para este filtro.</div>';
  bindStockActions();
}
function bindStockActions(){
  $$('[data-track]').forEach(n=>n.onchange=()=>toggleTracking(n.dataset.track,n.checked,n));
  $$('[data-move]').forEach(n=>n.onclick=()=>openMovement(n.dataset.move));
  $$('[data-minimum]').forEach(n=>n.onclick=()=>openMinimum(n.dataset.minimum));
  $$('[data-cost]').forEach(n=>n.onclick=()=>openCosts(n.dataset.cost));
}
async function toggleTracking(id,enabled,node){
  const p=product(id);if(!p)return;
  if(!confirm((enabled?'Activar':'Desactivar')+' Afecta inventario para '+p.name+'?'+(enabled&&p.legacyCoreStock>0?'\n\nSe migrará como saldo inicial la existencia actual del inventario anterior: '+q(p.legacyCoreStock)+'.':''))){node.checked=!enabled;return}
  node.disabled=true;
  try{
    notice('Actualizando control de inventario…');
    await V.api('/api/v1/restaurante/inventario-v1/productos/'+encodeURIComponent(id)+'/tracking',{method:'PATCH',body:JSON.stringify({enabled})});
    await loadWorkspace(false);notice(enabled?'Control de inventario activado.':'Control de inventario desactivado.');
  }catch(e){node.checked=!enabled;notice(e.message||'No fue posible cambiar el control.',true)}
  finally{node.disabled=false}
}
function openMovement(id){
  const p=product(id);if(!p)return;
  $('#movementProductId').value=id;$('#movementVersion').value=p.version;$('#movementTitle').textContent=p.name;$('#movementKind').value=p.onHand===0?'initial':'entry';$('#movementQuantity').value='';$('#movementReason').value='';err('#movementError');syncMovementLabel();$('#movementDialog').showModal();
}
function syncMovementLabel(){const kind=$('#movementKind').value;$('#movementQuantityLabel').textContent=(kind==='adjustment'||kind==='initial')?'Conteo / saldo final':'Cantidad'}
function openMinimum(id){const p=product(id);if(!p)return;$('#minimumProductId').value=id;$('#minimumVersion').value=p.version;$('#minimumTitle').textContent=p.name;$('#minimumValue').value=p.minimum;err('#minimumError');$('#minimumDialog').showModal()}
async function openCosts(id){
  const p=product(id);if(!p)return;$('#costTitle').textContent=p.name;$('#costRows').innerHTML='<div class="inv-empty">Cargando…</div>';$('#costDialog').showModal();
  try{const rows=await V.api('/api/v1/restaurante/inventario-v1/productos/'+encodeURIComponent(id)+'/costos');$('#costRows').innerHTML=rows.length?rows.map(r=>'<div class="inv-cost-row"><span>'+esc(dateOnly(r.purchaseDate))+'</span><div><b>'+esc(r.supplier)+'</b><br><span>'+esc(r.reference||('Pedido #'+r.purchaseNumber))+' · '+q(r.quantity)+' und.</span></div><strong>'+money(r.unitCost)+'</strong></div>').join(''):'<div class="inv-empty">Todavía no hay compras recibidas de este producto.</div>'}catch(e){$('#costRows').innerHTML='<div class="inv-error">'+esc(e.message)+'</div>'}
}

function renderPurchases(){
  const rows=S.purchases||[];
  $('#purchaseList').innerHTML=rows.length?rows.map(r=>'<article class="inv-purchase-card"><div class="inv-purchase-head"><div><b>Pedido #'+esc(r.number)+'</b><span>'+esc(dateOnly(r.purchaseDate))+'</span></div><span class="inv-status '+(r.status==='received'?'':'low')+'">'+(r.status==='received'?'RECIBIDO':'BORRADOR')+'</span></div><div class="inv-purchase-meta"><span><b>'+esc(r.supplier)+'</b></span><span>'+esc(r.reference||'Sin referencia')+'</span><span>'+esc(r.itemCount||0)+' producto(s) · '+(r.paymentTerms==='credit'?'Crédito':'Contado')+'</span></div><div class="inv-purchase-total"><span>Total</span><strong>'+money(r.total)+'</strong></div><div class="inv-row-actions">'+(r.status==='draft'?'<button class="rv2-btn" type="button" data-edit-purchase="'+esc(r.id)+'">Editar</button><button class="rv2-btn rv2-btn-primary" type="button" data-receive-purchase="'+esc(r.id)+'">Recibir pedido</button>':'<button class="rv2-btn" type="button" data-view-purchase="'+esc(r.id)+'">Ver detalle</button>')+'</div></article>').join(''):'<div class="inv-empty">Todavía no hay pedidos de inventario.</div>';
  $$('[data-edit-purchase]').forEach(b=>b.onclick=()=>editPurchase(b.dataset.editPurchase));
  $$('[data-view-purchase]').forEach(b=>b.onclick=()=>editPurchase(b.dataset.viewPurchase,true));
  $$('[data-receive-purchase]').forEach(b=>b.onclick=()=>receivePurchase(b.dataset.receivePurchase));
}
function productOptions(selected=''){return enabledProducts().map(p=>'<option value="'+esc(p.productId)+'" '+(p.productId===selected?'selected':'')+'>'+esc(p.name)+' · '+esc(p.sku)+'</option>').join('')}
function addPurchaseLine(row={}){
  const id='pl'+(++S.purchaseLines),host=$('#purchaseItems'),wrap=document.createElement('div');wrap.className='inv-purchase-line';wrap.dataset.purchaseLine=id;
  wrap.innerHTML='<label>Producto<select class="inv-select" data-pl-product>'+productOptions(row.productId||'')+'</select></label><label>Cantidad<input class="inv-input" data-pl-qty type="number" min="0.0001" step="0.0001" value="'+esc(row.quantity||1)+'"></label><label>Costo unitario<input class="inv-input" data-pl-cost type="number" min="0.0001" step="0.0001" value="'+esc(row.unitCost||0)+'"></label><label>IVA %<input class="inv-input" data-pl-tax type="number" min="0" max="100" step="0.01" value="'+esc(row.taxPercent||0)+'"></label><button class="rv2-btn" type="button" data-pl-remove>×</button>';
  host.appendChild(wrap);$('[data-pl-remove]',wrap).onclick=()=>{wrap.remove();renderPurchaseTotals()};$$('input,select',wrap).forEach(n=>{n.oninput=renderPurchaseTotals;n.onchange=renderPurchaseTotals});renderPurchaseTotals();
}
function purchaseLines(){
  return $$('.inv-purchase-line').map(row=>({productId:$('[data-pl-product]',row)?.value||'',quantity:num($('[data-pl-qty]',row)?.value),unitCost:num($('[data-pl-cost]',row)?.value),taxPercent:num($('[data-pl-tax]',row)?.value)})).filter(x=>x.productId);
}
function renderPurchaseTotals(){const lines=purchaseLines();let sub=0,tax=0;lines.forEach(l=>{const s=l.quantity*l.unitCost;sub+=s;tax+=s*l.taxPercent/100});$('#purchaseTotals').innerHTML='<span>Subtotal <b>'+money(sub)+'</b></span><span>IVA <b>'+money(tax)+'</b></span><span>Total <b>'+money(sub+tax)+'</b></span>'}
function resetPurchase(){
  $('#purchaseId').value='';$('#purchaseTitle').textContent='Nuevo pedido';$('#purchaseSupplier').value='';$('#purchaseReference').value='';$('#purchaseDate').value=today();$('#purchaseTerms').value='cash';$('#purchaseDue').value='';$('#purchaseDueWrap').hidden=true;$('#purchaseNotes').value='';$('#purchaseItems').innerHTML='';err('#purchaseError');addPurchaseLine();
  $$('#purchaseForm input,#purchaseForm select,#purchaseForm button').forEach(n=>n.disabled=false);
}
function openPurchase(){if(!enabledProducts().length){notice('Activa “Afecta inventario” en al menos un producto antes de crear un pedido.',true);return}resetPurchase();$('#purchaseDialog').showModal()}
async function editPurchase(id,readOnly=false){
  try{
    const r=await V.api('/api/v1/restaurante/inventario-v1/pedidos/'+encodeURIComponent(id));resetPurchase();$('#purchaseId').value=r.id;$('#purchaseTitle').textContent='Pedido #'+r.number;$('#purchaseSupplier').value=r.supplier;$('#purchaseReference').value=r.reference||'';$('#purchaseDate').value=String(r.purchaseDate||'').slice(0,10);$('#purchaseTerms').value=r.paymentTerms;$('#purchaseDue').value=r.dueDate?String(r.dueDate).slice(0,10):'';$('#purchaseDueWrap').hidden=r.paymentTerms!=='credit';$('#purchaseNotes').value=r.notes||'';$('#purchaseItems').innerHTML='';(r.items||[]).forEach(addPurchaseLine);if(readOnly||r.status!=='draft'){$$('#purchaseForm input,#purchaseForm select,#purchaseForm button[type="submit"],#addPurchaseLine,[data-pl-remove]').forEach(n=>n.disabled=true)}$('#purchaseDialog').showModal()
  }catch(e){notice(e.message||'No fue posible abrir el pedido.',true)}
}
async function receivePurchase(id){
  if(!confirm('¿Confirmar recepción? Las cantidades entrarán al inventario y el pedido quedará bloqueado.'))return;
  try{notice('Recibiendo pedido…');await V.api('/api/v1/restaurante/inventario-v1/pedidos/'+encodeURIComponent(id)+'/recibir',{method:'POST',body:'{}'});await Promise.all([loadWorkspace(false),loadPurchases(false)]);notice('Pedido recibido. Existencias actualizadas.')}catch(e){notice(e.message||'No fue posible recibir el pedido.',true)}
}

async function loadHistory(append=false){
  const params=new URLSearchParams();if($('#historyProduct').value)params.set('productId',$('#historyProduct').value);if($('#historyFrom').value)params.set('from',$('#historyFrom').value);if($('#historyTo').value)params.set('to',$('#historyTo').value);if(append&&S.historyNext)params.set('before',S.historyNext);
  const data=await V.api('/api/v1/restaurante/inventario-v1/movimientos?'+params.toString());S.history=append?[...S.history,...data.rows]:data.rows;S.historyNext=data.next;renderHistory();
}
function kindLabel(k){return({initial:'Saldo inicial',entry:'Entrada',exit:'Salida',adjustment:'Ajuste',reserve:'Reserva',sale:'Venta',return:'Devolución',waste:'Merma'})[k]||k}
function renderHistory(){
  $('#historyRows').innerHTML=S.history.length?S.history.map(r=>'<tr><td>#'+esc(r.number)+'</td><td>'+esc(dateText(r.creadoEn))+'</td><td class="inv-product"><b>'+esc(r.productName)+'</b></td><td>'+esc(kindLabel(r.kind))+'</td><td>'+q(r.units)+'</td><td class="'+(r.delta<0?'inv-out':r.delta>0?'inv-ok':'inv-reserved')+'">'+(r.delta>0?'+':'')+q(r.delta)+'</td><td class="inv-num">'+q(r.balance)+'</td><td>'+esc(r.reason)+'</td></tr>').join(''):'<tr><td colspan="8"><div class="inv-empty">No hay movimientos para este filtro.</div></td></tr>';$('#historyMore').hidden=!S.historyNext
}

function setTab(tab){S.tab=tab;$$('[data-inv-tab]').forEach(b=>b.classList.toggle('active',b.dataset.invTab===tab));$('#stockPanel').hidden=tab!=='stock';$('#purchasesPanel').hidden=tab!=='purchases';$('#historyPanel').hidden=tab!=='history';if(tab==='purchases'&&!S.purchases.length)loadPurchases();if(tab==='history'&&!S.history.length)loadHistory()}
async function loadWorkspace(show=true){if(show)notice('Actualizando inventario…');S.workspace=await V.api('/api/v1/restaurante/inventario-v1');renderMetrics();renderStock();const hp=$('#historyProduct'),current=hp.value;hp.innerHTML='<option value="">Todos los productos</option>'+(S.workspace.products||[]).map(p=>'<option value="'+esc(p.productId)+'">'+esc(p.name)+'</option>').join('');hp.value=[...hp.options].some(o=>o.value===current)?current:'';if(show)notice('Inventario actualizado.')}
async function loadPurchases(show=true){if(show)notice('Cargando pedidos…');S.purchases=await V.api('/api/v1/restaurante/inventario-v1/pedidos');renderPurchases();if(show)notice('Pedidos actualizados.')}
function bind(){
  $('#refresh').onclick=async()=>{try{await Promise.all([loadWorkspace(false),S.tab==='purchases'?loadPurchases(false):Promise.resolve()]);if(S.tab==='history')await loadHistory();notice('Información actualizada.')}catch(e){notice(e.message,true)}};
  $$('[data-inv-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.invTab));
  $('#stockSearch').oninput=renderStock;$('#stockFilter').onchange=renderStock;
  $('#movementKind').onchange=syncMovementLabel;
  $('#movementForm').onsubmit=async e=>{e.preventDefault();err('#movementError');try{await V.api('/api/v1/restaurante/inventario-v1/movimientos',{method:'POST',body:JSON.stringify({productId:$('#movementProductId').value,version:Number($('#movementVersion').value),kind:$('#movementKind').value,quantity:Number($('#movementQuantity').value),reason:$('#movementReason').value.trim()})});$('#movementDialog').close();await loadWorkspace(false);notice('Movimiento registrado.')}catch(x){err('#movementError',x.message)}};
  $('#minimumForm').onsubmit=async e=>{e.preventDefault();err('#minimumError');try{await V.api('/api/v1/restaurante/inventario-v1/productos/'+encodeURIComponent($('#minimumProductId').value)+'/minimo',{method:'PATCH',body:JSON.stringify({version:Number($('#minimumVersion').value),minimum:Number($('#minimumValue').value)})});$('#minimumDialog').close();await loadWorkspace(false);notice('Mínimo actualizado.')}catch(x){err('#minimumError',x.message)}};
  $$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close)?.close());
  $('#newPurchase').onclick=openPurchase;$('#newPurchase2').onclick=openPurchase;$('#addPurchaseLine').onclick=()=>addPurchaseLine();
  $('#purchaseTerms').onchange=()=>{$('#purchaseDueWrap').hidden=$('#purchaseTerms').value!=='credit'};
  $('#purchaseForm').onsubmit=async e=>{e.preventDefault();err('#purchaseError');try{const payload={id:$('#purchaseId').value||undefined,supplier:$('#purchaseSupplier').value.trim(),reference:$('#purchaseReference').value.trim(),purchaseDate:$('#purchaseDate').value,paymentTerms:$('#purchaseTerms').value,dueDate:$('#purchaseTerms').value==='credit'?$('#purchaseDue').value:null,notes:$('#purchaseNotes').value.trim(),items:purchaseLines()};await V.api('/api/v1/restaurante/inventario-v1/pedidos',{method:'POST',body:JSON.stringify(payload)});$('#purchaseDialog').close();await loadPurchases(false);notice('Pedido guardado como borrador.')}catch(x){err('#purchaseError',x.message)}};
  $('#historyApply').onclick=()=>loadHistory().catch(e=>notice(e.message,true));$('#historyMore').onclick=()=>loadHistory(true).catch(e=>notice(e.message,true));
  $('#exportStock').onclick=()=>{const rows=controlled();downloadCsv('Inventario_'+today()+'.csv',['SKU','Producto','Categoría','Saldo','Reservado','Disponible','Mínimo'],rows.map(p=>[p.sku,p.name,p.category,p.onHand,p.reserved,p.available,p.minimum]))};
  $('#exportHistory').onclick=()=>downloadCsv('Movimientos_inventario_'+today()+'.csv',['Número','Fecha','Producto','Movimiento','Unidades','Cambio','Saldo','Motivo'],S.history.map(r=>[r.number,r.creadoEn,r.productName,kindLabel(r.kind),r.units,r.delta,r.balance,r.reason]));
}
async function boot(){
  bind();$('#tenantLine').textContent=(session.tenant?.nombreEmpresa||session.subdomain)+' · inventario propio del restaurante';
  const d=new Date(),to=today(),from=new Date(d.getFullYear(),d.getMonth(),1);$('#historyTo').value=to;$('#historyFrom').value=[from.getFullYear(),String(from.getMonth()+1).padStart(2,'0'),String(from.getDate()).padStart(2,'0')].join('-');
  try{await loadWorkspace(false);notice('Inventario listo.')}catch(e){notice(e.message||'No fue posible cargar Inventario.',true)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();