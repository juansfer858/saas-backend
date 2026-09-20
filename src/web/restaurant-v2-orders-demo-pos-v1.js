/* VANTIX_DEMO_RESTAURANTE_BAR_ORDERS_V1 */
(()=>{'use strict';
const MARKER='VANTIX_DEMO_RESTAURANTE_BAR_ORDERS_V1';
const TENANT='demo-restaurante';
const RV2=window.RestaurantV2;
if(!RV2)return;
const session=RV2.readSession?.()||RV2.requireSession?.();
if(String(session?.subdomain||'').trim().toLowerCase()!==TENANT)return;

document.body.dataset.demoBarOrders='1';
document.documentElement.dataset.demoBarOrders=MARKER;

const S={
  workspace:null,menu:[],tableId:null,accountId:null,draft:null,
  category:'',search:'',filtered:[],focus:0,selected:new Set(),
  loading:false,busy:false,cash:null
};
const $=(q,root=document)=>root.querySelector(q);
const $$=(q,root=document)=>[...root.querySelectorAll(q)];
const esc=RV2.esc;
const money=v=>RV2.money(v||0);
const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const CAN_EDIT_PRICE=new Set(['ADMIN','SUPER_ADMIN','CAJERO']).has(String(session?.user?.rol||'').toUpperCase());

function root(){return $('#demoBarOrdersRoot')}
function currentTable(){return S.workspace?.tables?.find(row=>String(row.id)===String(S.tableId))||null}
function accounts(){return currentTable()?.accounts||[]}
function currentAccount(){return accounts().find(row=>String(row.id)===String(S.accountId))||null}
function accountLabel(acc=currentAccount()){return String(acc?.name||'').trim()||'Cuenta'}
function draftItems(){return (S.draft?.items||[]).filter(item=>item.editableDraft)}
function allItems(){return S.draft?.items||[]}
function pendingItems(){return draftItems()}
function sentItems(){return allItems().filter(item=>!item.editableDraft)}
function total(){return Number(S.draft?.sale?.total||currentAccount()?.sale?.total||0)}
function setStatus(text,error=false){
  const node=$('[data-demo-status]',root());
  if(node){node.textContent=text||'';node.classList.toggle('error',Boolean(error))}
}
function selectedCount(){return S.selected.size}

function mount(){
  if(root())return;
  const canonicalMain=document.querySelector('body>main');
  const main=document.createElement('main');
  main.id='demoBarOrdersRoot';
  main.className='demo-bar-orders-main';
  main.innerHTML='<div class="demo-bar-status" data-demo-status>Inicializando Pedidos…</div><div class="demo-bar-layout"><aside class="demo-bar-pane demo-bar-locations"><span class="demo-bar-cap">UBICACIONES</span><div class="demo-bar-location-scroll" data-demo-locations></div></aside><section class="demo-bar-pane demo-bar-catalog"><div class="demo-bar-categories" data-demo-categories></div><div class="demo-bar-catalog-head"><b>Agregar productos</b><label>Cantidad + nombre o código<input class="demo-bar-search" data-demo-search autocomplete="off" placeholder="Ej.: 5+cerv"></label><div class="demo-bar-hint">↑ ↓ Seleccionar · Enter Agregar</div></div><div class="demo-bar-catalog-summary" data-demo-catalog-summary></div><div class="demo-bar-products" data-demo-products></div></section><section class="demo-bar-pane demo-bar-account-pane"><div class="demo-bar-account-list"><div class="demo-bar-account-head"><strong data-demo-location>Selecciona una ubicación</strong><div class="demo-bar-account-head-actions"><button class="rv2-btn demo-bar-small-btn" data-demo-close-account>Cerrar cuenta</button><button class="rv2-btn demo-bar-small-btn" data-demo-new-account>+ Nueva cuenta</button></div></div><div class="demo-bar-account-table-wrap"><table class="demo-bar-account-table"><thead><tr><th>Cuenta</th><th class="demo-bar-num">Total</th></tr></thead><tbody data-demo-accounts></tbody></table></div></div><section class="demo-bar-order"><div class="demo-bar-order-head"><b data-demo-order-name>Nueva venta</b><small>CONSUMOS</small></div><div class="demo-bar-lines-wrap" data-demo-lines-wrap><div class="demo-bar-empty">Selecciona una cuenta o agrega un producto para comenzar.</div></div></section><section class="demo-bar-checkout"><div class="demo-bar-total"><span data-demo-item-count>0 unidades</span><strong data-demo-total>$0</strong></div><div class="demo-bar-actions"><button class="rv2-btn" data-demo-rename>Nombre</button><button class="rv2-btn" data-demo-split>Separar</button><button class="rv2-btn" data-demo-merge>Unir</button><button class="rv2-btn" data-demo-send>Enviar pedido</button><button class="rv2-btn" data-demo-prebill>Precuenta</button><button class="rv2-btn pay" data-demo-pay>Cobrar</button></div></section></section></div>';
  canonicalMain?.insertAdjacentElement('afterend',main);
  bindStatic();
}

function bindStatic(){
  const r=root();
  $('[data-demo-search]',r).addEventListener('input',event=>{S.search=event.target.value;S.focus=0;renderCatalog()});
  $('[data-demo-search]',r).addEventListener('keydown',event=>{
    if(['ArrowDown','ArrowUp'].includes(event.key)){
      event.preventDefault();
      S.focus=Math.max(0,Math.min(S.filtered.length-1,S.focus+(event.key==='ArrowDown'?1:-1)));
      renderProducts();
      $('[data-demo-products] .focused',r)?.scrollIntoView({block:'nearest'});
    }
    if(event.key==='Enter'){
      event.preventDefault();
      const item=S.filtered[S.focus];
      if(item)addProduct(item.id,parseSearchQuantity());
    }
  });
  $('[data-demo-new-account]',r).onclick=newAccount;
  $('[data-demo-close-account]',r).onclick=closeAccount;
  $('[data-demo-rename]',r).onclick=renameAccount;
  $('[data-demo-send]',r).onclick=sendPending;
  $('[data-demo-prebill]',r).onclick=requestPrebill;
  $('[data-demo-pay]',r).onclick=openCash;
  $('[data-demo-split]',r).onclick=openSplitDialog;
  $('[data-demo-merge]',r).onclick=openMergeDialog;
}

function parseSearchQuantity(){
  const raw=String(S.search||'').trim();
  const match=raw.match(/^(\d+)\s*\+\s*(.*)$/);
  if(!match)return 1;
  const n=Number(match[1]);
  return Number.isInteger(n)&&n>=1&&n<=999?n:1;
}
function searchTerm(){
  const raw=String(S.search||'').trim();
  const match=raw.match(/^(\d+)\s*\+\s*(.*)$/);
  return normalize(match?match[2]:raw);
}
function categories(){
  return [...new Set(S.menu.map(item=>item.displayCategory||item.category||'MENÚ'))].sort((a,b)=>String(a).localeCompare(String(b),'es'));
}

function renderLocations(){
  const box=$('[data-demo-locations]',root());
  const tables=S.workspace?.tables||[];
  let html='',lastZone=null;
  for(const table of tables){
    if(table.zoneName!==lastZone){lastZone=table.zoneName;html+='<div class="demo-bar-zone">'+esc(lastZone)+'</div>'}
    const count=table.accounts?.length||0;
    html+='<button class="demo-bar-place '+(count?'occupied ':'')+(String(table.id)===String(S.tableId)?'active':'')+'" data-demo-table="'+esc(table.id)+'"><span>'+esc(table.name||table.code)+'</span><small>'+(count?count+' cta.':'Libre')+'</small></button>';
  }
  box.innerHTML=html||'<div class="demo-bar-empty">No hay ubicaciones activas.</div>';
  $$('[data-demo-table]',box).forEach(btn=>btn.onclick=()=>selectTable(btn.dataset.demoTable));
}

function renderAccounts(){
  const table=currentTable();
  $('[data-demo-location]',root()).textContent=table?.name||'Selecciona una ubicación';
  const tbody=$('[data-demo-accounts]',root());
  const rows=accounts();
  tbody.innerHTML=rows.map(acc=>'<tr class="demo-bar-account-row '+(String(acc.id)===String(S.accountId)?'active':'')+'" data-demo-account="'+esc(acc.id)+'"><td><button>'+esc(accountLabel(acc))+'</button>'+(acc.accountRequestedAt?'<small style="display:block;color:var(--rv2-danger);margin-top:2px">Cuenta solicitada</small>':'')+'</td><td class="demo-bar-num">'+money(acc.sale?.total||0)+'</td></tr>').join('')||'<tr><td colspan="2">Sin cuentas abiertas</td></tr>';
  $$('[data-demo-account]',tbody).forEach(row=>row.onclick=()=>selectAccount(row.dataset.demoAccount));
  $('[data-demo-new-account]',root()).disabled=!table;
  $('[data-demo-close-account]',root()).disabled=!currentAccount();
}

function renderCatalog(){
  renderCategories();
  const term=searchTerm();
  S.filtered=S.menu.filter(item=>{
    const cat=item.displayCategory||item.category||'MENÚ';
    if(S.category&&cat!==S.category)return false;
    if(!term)return true;
    return normalize((item.product?.sku||'')+' '+(item.product?.nombre||'')+' '+cat).includes(term);
  });
  S.focus=Math.max(0,Math.min(S.focus,S.filtered.length-1));
  $('[data-demo-catalog-summary]',root()).textContent=(S.category||'Todos')+' · '+S.filtered.length+' productos';
  renderProducts();
}
function renderCategories(){
  const box=$('[data-demo-categories]',root());
  const cats=categories();
  const rows=[['','Todos',S.menu.length],...cats.map(cat=>[cat,cat,S.menu.filter(item=>(item.displayCategory||item.category||'MENÚ')===cat).length])];
  box.innerHTML=rows.map(([id,label,count])=>'<button class="demo-bar-category '+(S.category===id?'active':'')+'" data-demo-cat="'+esc(id)+'">'+esc(label)+' <small>'+count+'</small></button>').join('');
  $$('[data-demo-cat]',box).forEach(btn=>btn.onclick=()=>{S.category=btn.dataset.demoCat;S.search='';$('[data-demo-search]',root()).value='';S.focus=0;renderCatalog()});
}
function renderProducts(){
  const box=$('[data-demo-products]',root());
  box.innerHTML=S.filtered.map((item,index)=>'<button class="demo-bar-product '+(index===S.focus?'focused':'')+'" data-demo-product="'+esc(item.id)+'"><span><b>'+esc(item.product?.nombre||'Producto')+'</b><small>'+esc(item.product?.sku||'')+' · '+esc(item.displayCategory||item.category||'')+'</small></span><strong>'+money(item.product?.precio1||0)+'</strong></button>').join('')||'<div class="demo-bar-empty">No hay productos disponibles con estos filtros.</div>';
  $$('[data-demo-product]',box).forEach(btn=>btn.onclick=()=>addProduct(btn.dataset.demoProduct,1));
}

function renderOrder(){
  const acc=currentAccount();
  $('[data-demo-order-name]',root()).textContent=acc?accountLabel(acc):'Nueva venta';
  $('[data-demo-total]',root()).textContent=money(total());
  const items=allItems();
  const count=items.reduce((sum,item)=>sum+Number(item.quantity||0),0);
  $('[data-demo-item-count]',root()).textContent=count+' unidades';
  const wrap=$('[data-demo-lines-wrap]',root());
  if(!acc){wrap.innerHTML='<div class="demo-bar-empty">Busca un producto para comenzar una cuenta.</div>';renderActions();return}
  if(!items.length){wrap.innerHTML='<div class="demo-bar-empty">Busca un producto para comenzar esta cuenta.</div>';renderActions();return}
  wrap.innerHTML='<table class="demo-bar-lines"><thead><tr><th class="select-col"></th><th>Producto</th><th class="qty-col">Cant.</th><th class="price-col demo-bar-num">Precio</th><th class="subtotal-col demo-bar-num">Subtotal</th><th class="remove-col"></th></tr></thead><tbody>'+items.map(item=>{
    const draft=Boolean(item.editableDraft);
    const key=String(item.saleDetailId||item.id);
    const checked=S.selected.has(key);
    const status=String(item.operationalState||item.orderState||'Cuenta').replaceAll('_',' ');
    const origin=item.originTable?.name&&item.originTable.id!==S.tableId?' · origen '+item.originTable.name:'';
    const note=draft?'<textarea class="demo-bar-note" data-demo-note="'+esc(item.orderItemId||'')+'" maxlength="300" rows="1" placeholder="Observaciones">'+esc(item.notes||'')+'</textarea>':(item.notes?'<div class="demo-bar-note-sent">Obs: '+esc(item.notes)+'</div>':'');
    return '<tr><td><input type="checkbox" data-demo-select="'+esc(key)+'" '+(checked?'checked':'')+'></td><td class="demo-bar-line-name"><b>'+esc(item.description)+'</b><small>'+esc(item.station||'')+' · '+esc(status)+esc(origin)+'</small>'+note+'</td><td><input class="demo-bar-line-input" data-demo-qty="'+esc(item.orderItemId||'')+'" type="number" min="1" max="999" value="'+Number(item.quantity||0)+'" '+(draft?'':'disabled title="El consumo ya fue enviado"')+'></td><td><input class="demo-bar-line-input" data-demo-price="'+esc(item.saleDetailId||'')+'" type="number" min="0" step="100" value="'+Number(item.unitPrice||0)+'" '+(CAN_EDIT_PRICE?'':'disabled title="El mesero no puede modificar precios"')+'></td><td class="demo-bar-num">'+money(item.lineTotal||0)+'</td><td>'+(draft?'<button class="demo-bar-remove" data-demo-remove="'+esc(item.orderItemId||'')+'">×</button>':'')+'</td></tr>';
  }).join('')+'</tbody></table>';
  wrap.querySelectorAll('[data-demo-select]').forEach(box=>box.onchange=()=>{box.checked?S.selected.add(box.dataset.demoSelect):S.selected.delete(box.dataset.demoSelect);renderActions()});
  wrap.querySelectorAll('[data-demo-qty]').forEach(input=>input.onchange=()=>changeDraftQty(input.dataset.demoQty,Number(input.value)));
  wrap.querySelectorAll('[data-demo-remove]').forEach(btn=>btn.onclick=()=>changeDraftQty(btn.dataset.demoRemove,0));
  wrap.querySelectorAll('[data-demo-note]').forEach(input=>input.onchange=()=>changeNote(input.dataset.demoNote,input.value));
  wrap.querySelectorAll('[data-demo-price]').forEach(input=>input.onchange=()=>changePrice(input.dataset.demoPrice,Number(input.value)));
  renderActions();
}
function renderActions(){
  const acc=currentAccount();
  const hasPending=pendingItems().length>0;
  const hasItems=allItems().length>0;
  $('[data-demo-rename]',root()).disabled=!acc;
  $('[data-demo-split]',root()).disabled=!acc||!selectedCount();
  $('[data-demo-merge]',root()).disabled=!acc||(S.workspace?.tables||[]).flatMap(t=>t.accounts||[]).filter(a=>a.id!==acc.id).length===0;
  $('[data-demo-send]',root()).disabled=!acc||!hasPending;
  $('[data-demo-prebill]',root()).disabled=!acc||!hasItems;
  $('[data-demo-pay]',root()).disabled=!acc||!hasItems||hasPending;
  const pay=$('[data-demo-pay]',root());
  if(pay)pay.title=hasPending?'Envía los consumos nuevos antes de cobrar.':'';
}

function render(){
  renderLocations();
  renderAccounts();
  renderCatalog();
  renderOrder();
}

async function loadBase(preserve=true){
  if(S.loading)return;
  S.loading=true;
  try{
    setStatus('Actualizando ubicaciones, cuentas y carta…');
    const [workspace,menu]=await Promise.all([
      RV2.api('/api/v1/restaurante/v2/demo-bar/workspace'),
      RV2.api('/api/v1/restaurante/menu')
    ]);
    S.workspace=workspace;
    S.menu=(menu||[]).filter(item=>item.active!==false&&item.product);
    const tables=workspace.tables||[];
    if(!preserve||!tables.some(t=>String(t.id)===String(S.tableId)))S.tableId=tables[0]?.id||null;
    const accs=currentTable()?.accounts||[];
    if(!accs.some(a=>String(a.id)===String(S.accountId)))S.accountId=accs[0]?.id||null;
    render();
    if(S.accountId)await loadAccount(S.accountId);else{S.draft=null;renderOrder()}
    setStatus('Pedidos tipo VANTIX BAR activo solo en demo-restaurante.');
  }catch(error){setStatus(error.message||'No fue posible cargar el piloto.',true)}
  finally{S.loading=false}
}
async function selectTable(tableId){
  S.tableId=tableId;
  S.selected.clear();
  const accs=currentTable()?.accounts||[];
  S.accountId=accs[0]?.id||null;
  renderLocations();renderAccounts();
  if(S.accountId)await loadAccount(S.accountId);else{S.draft=null;renderOrder()}
  $('[data-demo-search]',root())?.focus({preventScroll:true});
}
async function selectAccount(accountId){
  S.accountId=accountId;S.selected.clear();renderAccounts();await loadAccount(accountId);$('[data-demo-search]',root())?.focus({preventScroll:true});
}
async function loadAccount(accountId){
  if(!accountId){S.draft=null;renderOrder();return}
  try{
    S.draft=await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(accountId)+'/detalle');
    const visible=new Set(allItems().map(item=>String(item.saleDetailId||item.id)));
    for(const id of [...S.selected])if(!visible.has(id))S.selected.delete(id);
    renderOrder();
  }catch(error){setStatus(error.message||'No fue posible cargar la cuenta.',true)}
}

async function ensureAccount(){
  if(S.accountId)return S.accountId;
  if(!S.tableId)throw new Error('Selecciona una ubicación.');
  const data=await RV2.api('/api/v1/restaurante/v2/demo-bar/mesas/'+encodeURIComponent(S.tableId)+'/cuentas',{method:'POST',body:JSON.stringify({name:'Cuenta'})});
  await loadBase(true);
  S.accountId=data.account.id;
  await loadAccount(S.accountId);
  return S.accountId;
}
async function newAccount(){
  if(!S.tableId)return;
  const name=prompt('Nombre de la nueva cuenta','Cuenta');
  if(name===null)return;
  try{
    const data=await RV2.api('/api/v1/restaurante/v2/demo-bar/mesas/'+encodeURIComponent(S.tableId)+'/cuentas',{method:'POST',body:JSON.stringify({name:name.trim()||'Cuenta'})});
    await loadBase(true);S.accountId=data.account.id;await loadAccount(S.accountId);setStatus('Nueva cuenta creada.');
  }catch(error){setStatus(error.message||'No fue posible crear la cuenta.',true)}
}
async function renameAccount(){
  const acc=currentAccount();if(!acc)return;
  const name=prompt('Nombre de la cuenta',accountLabel(acc));if(name===null)return;
  try{
    await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(acc.id),{method:'PATCH',body:JSON.stringify({name:name.trim()||'Cuenta'})});
    await loadBase(true);setStatus('Nombre actualizado.');
  }catch(error){setStatus(error.message||'No fue posible cambiar el nombre.',true)}
}
async function closeAccount(){
  const acc=currentAccount();if(!acc)return;
  if(allItems().length||total()>0){openCash();return}
  if(!confirm('Cerrar '+accountLabel(acc)+' vacía?'))return;
  try{
    await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(acc.id)+'/vacia',{method:'DELETE'});
    S.accountId=null;await loadBase(true);setStatus('Cuenta vacía cerrada.');
  }catch(error){setStatus(error.message||'No fue posible cerrar la cuenta.',true)}
}

async function addProduct(menuItemId,qty){
  if(S.busy)return;
  const item=S.menu.find(row=>String(row.id)===String(menuItemId));if(!item)return;
  qty=Math.max(1,Math.min(999,Number(qty)||1));
  S.busy=true;
  try{
    const accountId=await ensureAccount();
    const existing=draftItems().find(row=>String(row.menuItemId)===String(menuItemId)&&!row.seatNumber);
    const next=Number(existing?.quantity||0)+qty;
    await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(accountId)+'/pedido/items/'+encodeURIComponent(menuItemId),{method:'PUT',body:JSON.stringify({quantity:next,seatNumber:null})});
    await reopenAfterMutation(accountId);
    S.search='';$('[data-demo-search]',root()).value='';S.focus=0;
    await loadAccount(accountId);await refreshWorkspaceOnly();renderCatalog();
    setStatus('Producto agregado. Pulsa Enviar pedido para pasarlo a producción.');
  }catch(error){setStatus(error.message||'No fue posible agregar el producto.',true)}
  finally{S.busy=false}
}
async function reopenAfterMutation(accountId){
  try{await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(accountId)+'/reabrir',{method:'POST',body:'{}'})}catch{}
}
async function changeDraftQty(itemId,quantity){
  const item=draftItems().find(row=>String(row.orderItemId||row.id)===String(itemId));if(!item||!S.accountId)return;
  const q=Math.max(0,Math.min(999,Number(quantity)||0));
  try{
    await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(S.accountId)+'/pedido/items/'+encodeURIComponent(item.menuItemId),{method:'PUT',body:JSON.stringify({quantity:q,seatNumber:item.seatNumber??null})});
    await reopenAfterMutation(S.accountId);
    S.selected.delete(String(item.saleDetailId||item.id));await loadAccount(S.accountId);await refreshWorkspaceOnly();
  }catch(error){setStatus(error.message||'No fue posible cambiar la cantidad.',true)}
}
async function changeNote(itemId,notes){
  if(!S.accountId||!itemId)return;
  const value=String(notes||'').trim().slice(0,300);
  try{
    await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(S.accountId)+'/items/'+encodeURIComponent(itemId),{method:'PATCH',body:JSON.stringify({notes:value||null})});
    const item=draftItems().find(row=>String(row.orderItemId||row.id)===String(itemId));
    if(item)item.notes=value||null;
    setStatus(value?'Observación guardada. Se enviará con la comanda.':'Observación eliminada.');
  }catch(error){setStatus(error.message||'No fue posible guardar la observación.',true);await loadAccount(S.accountId)}
}

async function changePrice(detailId,unitPrice){
  if(!S.accountId||!detailId||!Number.isFinite(unitPrice)||unitPrice<0)return;
  try{
    await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(S.accountId)+'/items/'+encodeURIComponent(detailId)+'/precio',{method:'PATCH',body:JSON.stringify({unitPrice})});
    await reopenAfterMutation(S.accountId);
    await loadAccount(S.accountId);await refreshWorkspaceOnly();setStatus('Precio actualizado.');
  }catch(error){setStatus(error.message||'No fue posible cambiar el precio.',true);await loadAccount(S.accountId)}
}

async function sendPending(){
  if(!S.accountId||!pendingItems().length)return;
  try{
    const noteInputs=$('[data-demo-note]',root());
    for(const input of noteInputs){
      const item=draftItems().find(row=>String(row.orderItemId||row.id)===String(input.dataset.demoNote));
      const typed=String(input.value||'').trim().slice(0,300);
      const saved=String(item?.notes||'').trim();
      if(typed!==saved)await changeNote(input.dataset.demoNote,typed);
    }
    await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(S.accountId)+'/pedido/enviar',{method:'POST',body:'{}'});
    await loadAccount(S.accountId);await refreshWorkspaceOnly();setStatus('Pedido enviado a producción.');
  }catch(error){setStatus(error.message||'No fue posible enviar el pedido.',true)}
}
async function requestPrebill(){
  if(!S.accountId||!allItems().length)return;
  try{
    await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(S.accountId)+'/pedir-cuenta',{method:'POST',body:'{}'});
    await refreshWorkspaceOnly();
    openPrebill();
    setStatus('Precuenta solicitada para '+currentAccount()?.name+'.');
  }catch(error){setStatus(error.message||'No fue posible solicitar la precuenta.',true)}
}
function prebillHtml(){
  const table=currentTable(),acc=currentAccount(),items=allItems();
  return '<article class="demo-bar-prebill" id="demoBarPrebillPrint"><header><h2>PRECUENTA</h2><b>'+esc(session.tenant?.nombreEmpresa||'Vantix Restaurantes')+'</b><span>'+esc(table?.name||'')+' · '+esc(acc?.name||'Cuenta')+'</span></header><table><thead><tr><th>Cant.</th><th>Descripción</th><th>Valor</th></tr></thead><tbody>'+items.map(item=>'<tr><td>'+Number(item.quantity||0)+'</td><td>'+esc(item.description)+'</td><td>'+money(item.lineTotal||0)+'</td></tr>').join('')+'</tbody></table><footer><span>Total</span><strong>'+money(total())+'</strong><small>Pendiente de pago</small></footer></article>';
}
function openPrebill(){
  const dialog=ensureDialog();
  $('[data-dialog-eyebrow]',dialog).textContent='PRECUENTA';
  $('[data-dialog-title]',dialog).textContent=(currentTable()?.name||'Mesa')+' · '+(currentAccount()?.name||'Cuenta');
  const body=$('[data-dialog-body]',dialog);
  body.innerHTML=prebillHtml()+'<div class="demo-bar-dialog-actions"><button class="rv2-btn" data-prebill-close>Cerrar</button><button class="rv2-btn rv2-btn-primary" data-prebill-print>Imprimir</button></div>';
  $('[data-prebill-close]',body).onclick=()=>dialog.close();
  $('[data-prebill-print]',body).onclick=printPrebill;
  if(!dialog.open)dialog.showModal();
}
function printPrebill(){
  const node=$('#demoBarPrebillPrint');
  if(!node)return;
  const frame=document.createElement('iframe');
  frame.style.position='fixed';frame.style.width='1px';frame.style.height='1px';frame.style.opacity='0';frame.style.pointerEvents='none';
  document.body.appendChild(frame);
  const doc=frame.contentDocument;
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"><title>Precuenta</title><style>body{font-family:Arial,sans-serif;margin:0;padding:10mm;color:#111}article{max-width:80mm;margin:auto}header{text-align:center}header h2{margin:0 0 6px}header b,header span{display:block;margin:3px 0}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}th,td{padding:5px 2px;border-bottom:1px dashed #bbb;text-align:left}th:first-child,td:first-child{width:45px}th:last-child,td:last-child{text-align:right;white-space:nowrap}footer{margin-top:10px;border-top:2px solid #111;padding-top:8px}footer span,footer strong,footer small{display:block}footer strong{text-align:right;font-size:18px}footer small{text-align:center;margin-top:12px}@page{size:80mm auto;margin:4mm}</style></head><body>'+node.outerHTML+'</body></html>');
  doc.close();
  frame.onload=()=>{frame.contentWindow.focus();frame.contentWindow.print();setTimeout(()=>frame.remove(),800)};
}

function openSplitDialog(){
  const chosen=allItems().filter(item=>S.selected.has(String(item.saleDetailId||item.id)));
  if(!chosen.length)return;
  const dialog=ensureDialog();
  $('[data-dialog-eyebrow]',dialog).textContent='SEPARAR CONSUMOS';
  $('[data-dialog-title]',dialog).textContent=currentAccount()?.name||'Cuenta';
  const body=$('[data-dialog-body]',dialog);
  body.innerHTML='<label>Nombre de la nueva cuenta<input class="rv2-input" data-split-name value="Cuenta separada" maxlength="160"></label>'+chosen.map(item=>'<label>'+esc(item.description)+' · máximo '+Number(item.quantity||0)+'<input class="rv2-input" data-split-detail="'+esc(item.saleDetailId)+'" type="number" min="0.0001" max="'+Number(item.quantity||0)+'" step="0.0001" value="'+Number(item.quantity||0)+'"></label>').join('')+'<div class="demo-bar-dialog-status" data-dialog-status></div><div class="demo-bar-dialog-actions"><button class="rv2-btn" data-split-cancel>Cancelar</button><button class="rv2-btn rv2-btn-primary" data-split-confirm>Separar</button></div>';
  $('[data-split-cancel]',body).onclick=()=>dialog.close();
  $('[data-split-confirm]',body).onclick=confirmSplit;
  if(!dialog.open)dialog.showModal();
}
async function confirmSplit(){
  const dialog=$('#demoBarDialog'),body=$('[data-dialog-body]',dialog);
  const lines=$$('[data-split-detail]',body).map(input=>({detailId:input.dataset.splitDetail,quantity:Number(input.value)})).filter(row=>row.quantity>0);
  const name=$('[data-split-name]',body)?.value?.trim()||'Cuenta separada';
  if(!lines.length){dialogStatus('Selecciona al menos una cantidad válida.',true);return}
  try{
    dialogStatus('Separando consumos…');
    const result=await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(S.accountId)+'/separar',{method:'POST',body:JSON.stringify({name,lines})});
    dialog.close();S.selected.clear();await loadBase(true);S.accountId=result.accountId;await loadAccount(S.accountId);setStatus('Consumos separados en una nueva cuenta.');
  }catch(error){dialogStatus(error.message||'No fue posible separar los consumos.',true)}
}
function openMergeDialog(){
  const dest=currentAccount();if(!dest)return;
  const entries=(S.workspace?.tables||[]).flatMap(table=>(table.accounts||[]).map(acc=>({...acc,tableName:table.name}))).filter(acc=>acc.id!==dest.id);
  if(!entries.length)return;
  const dialog=ensureDialog();
  $('[data-dialog-eyebrow]',dialog).textContent='UNIR CUENTAS';
  $('[data-dialog-title]',dialog).textContent='Destino: '+(currentTable()?.name||'')+' · '+accountLabel(dest);
  const body=$('[data-dialog-body]',dialog);
  const groups=new Map();for(const entry of entries){if(!groups.has(entry.tableName))groups.set(entry.tableName,[]);groups.get(entry.tableName).push(entry)}
  body.innerHTML='<label>Nombre conjunto<input class="rv2-input" data-merge-name value="'+esc(dest.name)+'" maxlength="160"></label>'+[...groups.entries()].map(([tableName,rows])=>'<fieldset><legend>'+esc(tableName)+'</legend>'+rows.map(acc=>'<label style="display:flex;align-items:center;gap:8px;margin:6px 0"><input type="checkbox" data-merge-source="'+esc(acc.id)+'"><span style="flex:1">#'+esc(acc.number)+' · '+esc(acc.name)+'</span><strong>'+money(acc.sale?.total||0)+'</strong></label>').join('')+'</fieldset>').join('')+'<div class="demo-bar-dialog-status" data-dialog-status></div><div class="demo-bar-dialog-actions"><button class="rv2-btn" data-merge-cancel>Cancelar</button><button class="rv2-btn rv2-btn-primary" data-merge-confirm>Unir seleccionadas</button></div>';
  $('[data-merge-cancel]',body).onclick=()=>dialog.close();
  $('[data-merge-confirm]',body).onclick=confirmMerge;
  if(!dialog.open)dialog.showModal();
}
async function confirmMerge(){
  const dialog=$('#demoBarDialog'),body=$('[data-dialog-body]',dialog);
  const sources=$$('[data-merge-source]:checked',body).map(input=>input.dataset.mergeSource);
  const name=$('[data-merge-name]',body)?.value?.trim()||accountLabel();
  if(!sources.length){dialogStatus('Selecciona al menos una cuenta para unir.',true);return}
  try{
    dialogStatus('Uniendo cuentas…');
    const dest=S.accountId;
    await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(dest)+'/unir',{method:'POST',body:JSON.stringify({name,sources})});
    dialog.close();S.selected.clear();await loadBase(true);S.accountId=dest;await loadAccount(dest);setStatus('Cuentas unidas.');
  }catch(error){dialogStatus(error.message||'No fue posible unir las cuentas.',true)}
}

async function refreshWorkspaceOnly(){
  try{
    S.workspace=await RV2.api('/api/v1/restaurante/v2/demo-bar/workspace');
    if(!currentTable())S.tableId=S.workspace.tables?.[0]?.id||null;
    if(!currentAccount()){
      const accs=currentTable()?.accounts||[];
      S.accountId=accs[0]?.id||null;
    }
    renderLocations();renderAccounts();
  }catch{}
}

function ensureDialog(){
  let dialog=$('#demoBarDialog');if(dialog)return dialog;
  dialog=document.createElement('dialog');dialog.id='demoBarDialog';dialog.className='demo-bar-dialog';
  dialog.innerHTML='<div class="demo-bar-dialog-shell"><div class="demo-bar-dialog-head"><div><small data-dialog-eyebrow>OPERACIÓN</small><h2 data-dialog-title>—</h2></div><button type="button" class="rv2-btn demo-bar-small-btn" data-dialog-close>Cerrar</button></div><div class="demo-bar-dialog-body" data-dialog-body></div></div>';
  document.body.appendChild(dialog);$('[data-dialog-close]',dialog).onclick=()=>dialog.close();dialog.addEventListener('close',()=>{delete dialog.dataset.cashBarMode});return dialog;
}
function dialogStatus(text,error=false){
  const node=$('[data-dialog-status]',$('#demoBarDialog'));if(node){node.textContent=text||'';node.classList.toggle('error',Boolean(error))}
}
async function openCash(){
  if(!S.accountId||pendingItems().length){if(pendingItems().length)setStatus('Envía los consumos nuevos antes de cobrar.',true);return}
  const dialog=ensureDialog();dialog.dataset.cashBarMode='1';$('[data-dialog-eyebrow]',dialog).textContent='COBRO';$('[data-dialog-title]',dialog).textContent='Cobrar '+accountLabel();const body=$('[data-dialog-body]',dialog);body.innerHTML='<div class="rv2-muted">Cargando Caja…</div>';dialog.showModal();
  try{
    const [cashWorkspace,detail]=await Promise.all([
      RV2.api('/api/v1/restaurante/v2/caja'),
      RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(S.accountId)+'/caja')
    ]);
    const methods=(detail.paymentMethods||[]).filter(method=>String(method.kind||'').toUpperCase()!=='CREDITO');
    S.cash={workspace:cashWorkspace,detail,methods,methodId:methods[0]?.id||null,busy:false};
    renderCash();
  }catch(error){body.innerHTML='<div class="demo-bar-dialog-status error">'+esc(error.message||'No fue posible abrir Caja.')+'</div>'}
}
function currentCashMethod(){
  const cash=S.cash;if(!cash)return null;
  return (cash.methods||[]).find(method=>String(method.id)===String(cash.methodId))||null;
}
function cashPaymentDue(){
  const cash=S.cash;if(!cash)return 0;
  const dialog=$('#demoBarDialog');
  const tip=Math.max(0,Number($('[data-cash-tip]',dialog)?.value||0));
  return Number(cash.detail?.sale?.total||0)+tip;
}
function syncCashTender(forceExact=false){
  const cash=S.cash,dialog=$('#demoBarDialog');if(!cash||!dialog)return;
  const method=currentCashMethod();
  const isCash=String(method?.kind||'').toUpperCase()==='EFECTIVO';
  const tenderGroup=$('[data-cash-tender-group]',dialog);
  const changeGroup=$('[data-cash-change-group]',dialog);
  const referenceGroup=$('[data-cash-reference-group]',dialog);
  const tender=$('[data-cash-tendered]',dialog);
  const change=$('[data-cash-change]',dialog);
  const hint=$('[data-cash-change-hint]',dialog);
  const confirmBtn=$('[data-charge]',dialog);
  if(tenderGroup)tenderGroup.hidden=!isCash;
  if(changeGroup)changeGroup.hidden=!isCash;
  if(referenceGroup)referenceGroup.hidden=isCash;
  const due=cashPaymentDue();
  if(isCash&&tender){
    if(forceExact||!Number.isFinite(Number(tender.value))||Number(tender.value)<=0)tender.value=String(Math.round(due));
    const received=Math.max(0,Number(tender.value||0));
    const delta=received-due;
    if(change)change.textContent=money(Math.max(0,delta));
    if(hint){
      hint.textContent=delta<0?'Faltan '+money(Math.abs(delta)):delta===0?'Pago exacto':'Devolver '+money(delta);
      hint.classList.toggle('error',delta<0);
    }
    if(confirmBtn)confirmBtn.disabled=delta<0||cash.busy;
  }else if(confirmBtn){
    confirmBtn.disabled=!method||cash.busy;
  }
}
function renderCash(){
  const dialog=$('#demoBarDialog'),body=$('[data-dialog-body]',dialog),cash=S.cash;if(!cash)return;
  const detail=cash.detail,account=currentAccount(),table=currentTable();
  $('[data-dialog-title]',dialog).textContent='Cobrar '+accountLabel(account);
  if(!cash.workspace?.shift?.own){
    const accounts=cash.workspace?.shift?.cashAccounts||[];
    body.innerHTML='<div><b>Turno de Caja cerrado</b><p>Abre tu turno para cobrar esta cuenta.</p><div class="demo-bar-payment-fields"><label>Caja<select class="rv2-input" data-cash-account>'+accounts.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.nombre)+'</option>').join('')+'</select></label><label>Base inicial<input class="rv2-input" data-cash-base type="number" min="0" step="100" value="0"></label></div><button class="rv2-btn rv2-btn-primary" data-open-shift '+(accounts.length?'':'disabled')+'>Abrir turno</button></div><div class="demo-bar-dialog-status" data-dialog-status></div>';
    $('[data-open-shift]',body)?.addEventListener('click',openShift);
    return;
  }
  const methods=cash.methods||[];
  if(!methods.some(m=>String(m.id)===String(cash.methodId)))cash.methodId=methods[0]?.id||null;
  if(!methods.length){
    body.innerHTML='<div class="demo-bar-dialog-status error">No hay medios de pago activos disponibles para este cobro.</div><div class="demo-bar-cash-actions"><button type="button" class="rv2-btn" data-cash-cancel>Cancelar</button></div>';
    $('[data-cash-cancel]',body).onclick=()=>dialog.close();
    return;
  }
  body.innerHTML='<div class="demo-bar-cash-context">'+esc(table?.name||'Mesa')+' · '+esc(accountLabel(account))+'</div><div class="demo-bar-cash-total">'+money(detail.sale?.total||0)+'</div><div class="demo-bar-cash-form"><label class="demo-bar-cash-field demo-bar-cash-method-field"><span>Medio de pago</span><select class="rv2-input demo-bar-cash-select" data-cash-method-select>'+methods.map(m=>'<option value="'+esc(m.id)+'" '+(String(m.id)===String(cash.methodId)?'selected':'')+'>'+esc(m.name)+'</option>').join('')+'</select></label><div class="demo-bar-cash-two"><label class="demo-bar-cash-field"><span>Propina</span><input class="rv2-input" data-cash-tip type="number" min="0" step="100" value="0"></label><label class="demo-bar-cash-field" data-cash-reference-group><span>Referencia</span><input class="rv2-input" data-cash-reference maxlength="160" placeholder="Opcional"></label></div><div class="demo-bar-cash-two"><label class="demo-bar-cash-field" data-cash-tender-group><span>Efectivo recibido</span><input class="rv2-input" data-cash-tendered type="number" min="0" step="100" inputmode="decimal"></label><div class="demo-bar-cash-change" data-cash-change-group><span>Cambio</span><strong data-cash-change>'+money(0)+'</strong><small data-cash-change-hint>Pago exacto</small></div></div></div><div class="demo-bar-dialog-status" data-dialog-status></div><div class="demo-bar-cash-actions"><button type="button" class="rv2-btn" data-cash-cancel>Cancelar</button><button type="button" class="rv2-btn rv2-btn-primary" data-charge>Confirmar cobro</button></div>';
  $('[data-cash-method-select]',body).onchange=event=>{cash.methodId=event.target.value;syncCashTender(true)};
  $('[data-cash-tip]',body).oninput=()=>syncCashTender(false);
  $('[data-cash-tendered]',body).oninput=()=>syncCashTender(false);
  $('[data-cash-cancel]',body).onclick=()=>dialog.close();
  $('[data-charge]',body).onclick=charge;
  syncCashTender(true);
}
async function openShift(){
  const dialog=$('#demoBarDialog'),account=$('[data-cash-account]',dialog)?.value,base=Number($('[data-cash-base]',dialog)?.value||0);if(!account)return;
  try{
    await RV2.api('/api/v1/restaurante/v2/caja/turno/abrir',{method:'POST',body:JSON.stringify({cajaBancoId:account,saldoInicial:base})});
    S.cash.workspace=await RV2.api('/api/v1/restaurante/v2/caja');renderCash();
  }catch(error){dialogStatus(error.message||'No fue posible abrir el turno.',true)}
}
async function charge(){
  const cash=S.cash;if(!cash||cash.busy)return;
  const method=currentCashMethod();if(!method)return;
  const dialog=$('#demoBarDialog'),tip=Math.max(0,Number($('[data-cash-tip]',dialog)?.value||0));
  const isCash=String(method.kind||'').toUpperCase()==='EFECTIVO';
  const due=Number(cash.detail.sale?.total||0)+tip;
  const received=isCash?Math.max(0,Number($('[data-cash-tendered]',dialog)?.value||0)):0;
  if(isCash&&received<due){syncCashTender(false);return}
  const typedReference=$('[data-cash-reference]',dialog)?.value?.trim()||'';
  const cashReference=isCash?'Recibido '+received+' · Cambio '+Math.max(0,received-due):'';
  const reference=(isCash?cashReference:typedReference).slice(0,160)||null;
  cash.busy=true;syncCashTender(false);dialogStatus('Registrando cobro…');
  try{
    const data=await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(S.accountId)+'/cobrar',{method:'POST',body:JSON.stringify({paymentMethodId:method.id,tipAmount:tip,reference})});
    renderCashResult(data);
  }catch(error){dialogStatus(error.message||'No fue posible cobrar.',true)}
  finally{cash.busy=false;syncCashTender(false)}
}
function renderCashResult(data){
  const dialog=$('#demoBarDialog'),body=$('[data-dialog-body]',dialog),sessionId=data?.result?.session?.id||null;
  body.innerHTML='<div><small>VENTA LIQUIDADA</small><h2>'+esc(accountLabel())+'</h2><p>La cuenta quedó pagada. ¿Deseas imprimir?</p><div class="demo-bar-print-actions"><button class="rv2-btn rv2-btn-primary" data-print>Sí, imprimir</button><button class="rv2-btn" data-no-print>No</button></div><div class="demo-bar-dialog-status" data-dialog-status></div></div>';
  $('[data-print]',body).onclick=()=>printReceipt(sessionId);
  $('[data-no-print]',body).onclick=finishCash;
}
async function printReceipt(sessionId){
  try{
    dialogStatus('Enviando recibo a impresión…');
    await RV2.api('/api/v1/restaurante/v2/caja/recibo/imprimir',{method:'POST',body:JSON.stringify({sessionId})});
    dialogStatus('Recibo enviado.');setTimeout(finishCash,350);
  }catch(error){dialogStatus('La venta está liquidada, pero no se pudo imprimir: '+(error.message||'error'),true)}
}
async function finishCash(){
  $('#demoBarDialog')?.close();S.cash=null;S.accountId=null;S.draft=null;S.selected.clear();await loadBase(true);setStatus('Cobro registrado.');
}

function realtime(){
  clearTimeout(realtime.timer);realtime.timer=setTimeout(()=>loadBase(true),100);
}
function start(){
  mount();
  $('#backToTables')?.remove();
  const title=$('.rv2-order-top h1');if(title)title.textContent='Pedidos';
  const line=$('#tenantLine');if(line)line.textContent=(session.tenant?.nombreEmpresa||session.subdomain)+' · comportamiento VANTIX BAR';
  $('#refresh')?.addEventListener('click',()=>loadBase(true));
  window.addEventListener('vantix:tenant-realtime',realtime);
  loadBase(false);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.VantixDemoRestaurantBarOrdersV1=Object.freeze({marker:MARKER,tenant:TENANT,refresh:()=>loadBase(true)});
})();