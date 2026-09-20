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

function root(){return $('#demoBarOrdersRoot')}
function currentTable(){return S.workspace?.tables?.find(row=>String(row.id)===String(S.tableId))||null}
function accounts(){return currentTable()?.accounts||[]}
function currentAccount(){return accounts().find(row=>String(row.id)===String(S.accountId))||null}
function draftItems(){return S.draft?.order?.items||[]}
function allItems(){return S.draft?.service?.allItems||[]}
function pendingItems(){return allItems().filter(item=>String(item.orderState)==='BORRADOR')}
function sentItems(){return allItems().filter(item=>String(item.orderState)!=='BORRADOR')}
function total(){return Number(S.draft?.service?.total||currentAccount()?.sale?.total||0)}
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
  main.innerHTML='<div class="demo-bar-status" data-demo-status>Inicializando Pedidos…</div><div class="demo-bar-layout"><aside class="demo-bar-pane demo-bar-locations"><span class="demo-bar-cap">UBICACIONES</span><div class="demo-bar-location-scroll" data-demo-locations></div></aside><section class="demo-bar-pane demo-bar-catalog"><div class="demo-bar-categories" data-demo-categories></div><div class="demo-bar-catalog-head"><b>Agregar productos</b><label>Cantidad + nombre o código<input class="demo-bar-search" data-demo-search autocomplete="off" placeholder="Ej.: 5+cerv"></label><div class="demo-bar-hint">↑ ↓ Seleccionar · Enter Agregar</div></div><div class="demo-bar-catalog-summary" data-demo-catalog-summary></div><div class="demo-bar-products" data-demo-products></div></section><section class="demo-bar-pane demo-bar-account-pane"><div class="demo-bar-account-list"><div class="demo-bar-account-head"><strong data-demo-location>Selecciona una ubicación</strong><div class="demo-bar-account-head-actions"><button class="rv2-btn demo-bar-small-btn" data-demo-close-account>Cerrar cuenta</button><button class="rv2-btn demo-bar-small-btn" data-demo-new-account>+ Nueva cuenta</button></div></div><div class="demo-bar-account-table-wrap"><table class="demo-bar-account-table"><thead><tr><th>Pedido</th><th>Cuenta</th><th class="demo-bar-num">Total</th></tr></thead><tbody data-demo-accounts></tbody></table></div></div><section class="demo-bar-order"><div class="demo-bar-order-head"><b data-demo-order-name>Nueva venta</b><small>CONSUMOS</small></div><div class="demo-bar-lines-wrap" data-demo-lines-wrap><div class="demo-bar-empty">Selecciona una cuenta o agrega un producto para comenzar.</div></div></section><section class="demo-bar-checkout"><div class="demo-bar-total"><span data-demo-item-count>0 unidades</span><strong data-demo-total>$0</strong></div><div class="demo-bar-actions"><button class="rv2-btn" data-demo-rename>Nombre</button><button class="rv2-btn" data-demo-split>Separar</button><button class="rv2-btn" data-demo-merge>Unir</button><button class="rv2-btn" data-demo-send>Enviar pedido</button><button class="rv2-btn" data-demo-prebill>Precuenta</button><button class="rv2-btn pay" data-demo-pay>Cobrar</button></div></section></section></div>';
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
  $('[data-demo-split]',r).onclick=splitSelectedDraft;
  $('[data-demo-merge]',r).onclick=mergeDraftAccount;
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
  tbody.innerHTML=rows.map(acc=>'<tr class="demo-bar-account-row '+(String(acc.id)===String(S.accountId)?'active':'')+'" data-demo-account="'+esc(acc.id)+'"><td>#'+esc(acc.number||'—')+'</td><td><button>'+esc(acc.name||'Cuenta')+'</button>'+(acc.accountRequestedAt?'<small style="display:block;color:var(--rv2-danger);margin-top:2px">Cuenta solicitada</small>':'')+'</td><td class="demo-bar-num">'+money(acc.sale?.total||0)+'</td></tr>').join('')||'<tr><td colspan="3">Sin cuentas abiertas</td></tr>';
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
  $('[data-demo-order-name]',root()).textContent=acc?'Pedido #'+(acc.number||'—')+' · '+acc.name:'Nueva venta';
  $('[data-demo-total]',root()).textContent=money(total());
  const items=allItems();
  const count=items.reduce((sum,item)=>sum+Number(item.quantity||0),0);
  $('[data-demo-item-count]',root()).textContent=count+' unidades';
  const wrap=$('[data-demo-lines-wrap]',root());
  if(!acc){wrap.innerHTML='<div class="demo-bar-empty">Busca un producto para comenzar una cuenta.</div>';renderActions();return}
  if(!items.length){wrap.innerHTML='<div class="demo-bar-empty">Busca un producto para comenzar esta cuenta.</div>';renderActions();return}
  wrap.innerHTML='<table class="demo-bar-lines"><thead><tr><th class="select-col"></th><th>Producto</th><th class="qty-col">Cant.</th><th class="price-col demo-bar-num">Precio</th><th class="subtotal-col demo-bar-num">Subtotal</th><th class="remove-col"></th></tr></thead><tbody>'+items.map(item=>{
    const draft=String(item.orderState)==='BORRADOR';
    const checked=S.selected.has(item.id);
    const status=draft?'Por enviar':String(item.orderState||'Enviado').replaceAll('_',' ');
    return '<tr><td><input type="checkbox" data-demo-select="'+esc(item.id)+'" '+(checked?'checked':'')+' '+(draft?'':'disabled')+'></td><td class="demo-bar-line-name"><b>'+esc(item.description)+'</b><small>'+esc(item.station||'')+' · '+esc(status)+(item.notes?' · '+esc(item.notes):'')+'</small></td><td><input class="demo-bar-line-input" data-demo-qty="'+esc(item.id)+'" type="number" min="1" max="999" value="'+Number(item.quantity||0)+'" '+(draft?'':'disabled')+'></td><td><input class="demo-bar-line-input" data-demo-price="'+esc(item.saleDetailId||'')+'" type="number" min="0" step="100" value="'+Number(item.unitPrice||0)+'"></td><td class="demo-bar-num">'+money(item.lineTotal||0)+'</td><td>'+(draft?'<button class="demo-bar-remove" data-demo-remove="'+esc(item.id)+'">×</button>':'')+'</td></tr>';
  }).join('')+'</tbody></table>';
  $$('[data-demo-select]',wrap).forEach(box=>box.onchange=()=>{box.checked?S.selected.add(box.dataset.demoSelect):S.selected.delete(box.dataset.demoSelect);renderActions()});
  $$('[data-demo-qty]',wrap).forEach(input=>input.onchange=()=>changeDraftQty(input.dataset.demoQty,Number(input.value)));
  $$('[data-demo-remove]',wrap).forEach(btn=>btn.onclick=()=>changeDraftQty(btn.dataset.demoRemove,0));
  $$('[data-demo-price]',wrap).forEach(input=>input.onchange=()=>changePrice(input.dataset.demoPrice,Number(input.value)));
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
    S.draft=await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(accountId)+'/pedido');
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
  const name=prompt('Nombre de la cuenta',acc.name||'Cuenta');if(name===null)return;
  try{
    await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(acc.id),{method:'PATCH',body:JSON.stringify({name:name.trim()||'Cuenta'})});
    await loadBase(true);setStatus('Nombre actualizado.');
  }catch(error){setStatus(error.message||'No fue posible cambiar el nombre.',true)}
}
async function closeAccount(){
  const acc=currentAccount();if(!acc)return;
  if(allItems().length||total()>0){openCash();return}
  if(!confirm('Cerrar '+acc.name+' vacía?'))return;
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
    S.search='';$('[data-demo-search]',root()).value='';S.focus=0;
    await loadAccount(accountId);await refreshWorkspaceOnly();renderCatalog();
    setStatus('Producto agregado. Pulsa Enviar pedido para pasarlo a producción.');
  }catch(error){setStatus(error.message||'No fue posible agregar el producto.',true)}
  finally{S.busy=false}
}
async function changeDraftQty(itemId,quantity){
  const item=draftItems().find(row=>String(row.id)===String(itemId));if(!item||!S.accountId)return;
  const q=Math.max(0,Math.min(999,Number(quantity)||0));
  try{
    await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(S.accountId)+'/pedido/items/'+encodeURIComponent(item.menuItemId),{method:'PUT',body:JSON.stringify({quantity:q,seatNumber:item.seatNumber??null})});
    S.selected.delete(item.id);await loadAccount(S.accountId);await refreshWorkspaceOnly();
  }catch(error){setStatus(error.message||'No fue posible cambiar la cantidad.',true)}
}
async function changePrice(detailId,unitPrice){
  if(!S.accountId||!detailId||!Number.isFinite(unitPrice)||unitPrice<0)return;
  try{
    await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(S.accountId)+'/items/'+encodeURIComponent(detailId)+'/precio',{method:'PATCH',body:JSON.stringify({unitPrice})});
    await loadAccount(S.accountId);await refreshWorkspaceOnly();setStatus('Precio actualizado.');
  }catch(error){setStatus(error.message||'No fue posible cambiar el precio.',true);await loadAccount(S.accountId)}
}

async function sendPending(){
  if(!S.accountId||!pendingItems().length)return;
  try{
    await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(S.accountId)+'/pedido/enviar',{method:'POST',body:'{}'});
    await loadAccount(S.accountId);await refreshWorkspaceOnly();setStatus('Pedido enviado a producción.');
  }catch(error){setStatus(error.message||'No fue posible enviar el pedido.',true)}
}
async function requestPrebill(){
  if(!S.accountId||!allItems().length)return;
  try{
    await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(S.accountId)+'/pedir-cuenta',{method:'POST',body:'{}'});
    await refreshWorkspaceOnly();setStatus('Precuenta solicitada para '+currentAccount()?.name+'.');
  }catch(error){setStatus(error.message||'No fue posible solicitar la precuenta.',true)}
}

async function splitSelectedDraft(){
  const selected=draftItems().filter(item=>S.selected.has(item.id));
  if(!selected.length)return;
  const name=prompt('Nombre de la nueva cuenta','Cuenta separada');if(name===null)return;
  try{
    const created=await RV2.api('/api/v1/restaurante/v2/demo-bar/mesas/'+encodeURIComponent(S.tableId)+'/cuentas',{method:'POST',body:JSON.stringify({name:name.trim()||'Cuenta separada'})});
    const dest=created.account.id;
    for(const item of selected){
      await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(S.accountId)+'/pedido/items/'+encodeURIComponent(item.menuItemId),{method:'PUT',body:JSON.stringify({quantity:0,seatNumber:item.seatNumber??null})});
      const result=await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(dest)+'/pedido/items/'+encodeURIComponent(item.menuItemId),{method:'PUT',body:JSON.stringify({quantity:Number(item.quantity||0),seatNumber:item.seatNumber??null})});
      const moved=(result?.order?.items||[]).find(row=>String(row.menuItemId)===String(item.menuItemId)&&Number(row.seatNumber||0)===Number(item.seatNumber||0));
      if(moved&&item.notes)await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(dest)+'/items/'+encodeURIComponent(moved.id),{method:'PATCH',body:JSON.stringify({notes:item.notes})});
    }
    S.selected.clear();await loadBase(true);S.accountId=dest;await loadAccount(dest);setStatus('Consumos por enviar separados en una nueva cuenta.');
  }catch(error){setStatus(error.message||'No fue posible separar los consumos.',true)}
}
async function mergeDraftAccount(){
  const dest=currentAccount();if(!dest)return;
  const all=(S.workspace?.tables||[]).flatMap(table=>(table.accounts||[]).map(acc=>({...acc,tableName:table.name}))).filter(acc=>acc.id!==dest.id);
  if(!all.length)return;
  const menu=all.map((acc,index)=>(index+1)+'. '+acc.tableName+' · #'+acc.number+' · '+acc.name+' · '+money(acc.sale?.total||0)).join('\n');
  const choice=prompt('Cuenta para unir con '+dest.name+':\n'+menu+'\n\nEscribe el número de la lista','1');
  if(choice===null)return;
  const source=all[Number(choice)-1];if(!source){setStatus('Selección inválida.',true);return}
  try{
    const src=await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(source.id)+'/pedido');
    const srcItems=src?.service?.allItems||[];
    if(srcItems.some(item=>String(item.orderState)!=='BORRADOR'))throw new Error('Por seguridad, esta primera prueba solo une cuentas cuyos consumos todavía no se han enviado a producción.');
    for(const item of srcItems){
      const existing=draftItems().find(row=>String(row.menuItemId)===String(item.menuItemId)&&Number(row.seatNumber||0)===Number(item.seatNumber||0));
      await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(dest.id)+'/pedido/items/'+encodeURIComponent(item.menuItemId),{method:'PUT',body:JSON.stringify({quantity:Number(existing?.quantity||0)+Number(item.quantity||0),seatNumber:item.seatNumber??null})});
      await RV2.api('/api/v1/restaurante/v2/sesiones/'+encodeURIComponent(source.id)+'/pedido/items/'+encodeURIComponent(item.menuItemId),{method:'PUT',body:JSON.stringify({quantity:0,seatNumber:item.seatNumber??null})});
    }
    await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(source.id)+'/vacia',{method:'DELETE'});
    await loadBase(true);S.accountId=dest.id;await loadAccount(dest.id);setStatus('Cuentas unidas.');
  }catch(error){setStatus(error.message||'No fue posible unir las cuentas.',true)}
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
  document.body.appendChild(dialog);$('[data-dialog-close]',dialog).onclick=()=>dialog.close();return dialog;
}
function dialogStatus(text,error=false){
  const node=$('[data-dialog-status]',$('#demoBarDialog'));if(node){node.textContent=text||'';node.classList.toggle('error',Boolean(error))}
}
async function openCash(){
  if(!S.accountId||pendingItems().length){if(pendingItems().length)setStatus('Envía los consumos nuevos antes de cobrar.',true);return}
  const dialog=ensureDialog();$('[data-dialog-eyebrow]',dialog).textContent='COBRO';$('[data-dialog-title]',dialog).textContent='Cobrar '+currentAccount().name;const body=$('[data-dialog-body]',dialog);body.innerHTML='<div class="rv2-muted">Cargando Caja…</div>';dialog.showModal();
  try{
    const [cashWorkspace,detail]=await Promise.all([
      RV2.api('/api/v1/restaurante/v2/caja'),
      RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(S.accountId)+'/caja')
    ]);
    S.cash={workspace:cashWorkspace,detail,methodId:detail.paymentMethods?.[0]?.id||null,busy:false};
    renderCash();
  }catch(error){body.innerHTML='<div class="demo-bar-dialog-status error">'+esc(error.message||'No fue posible abrir Caja.')+'</div>'}
}
function renderCash(){
  const dialog=$('#demoBarDialog'),body=$('[data-dialog-body]',dialog),cash=S.cash;if(!cash)return;
  const detail=cash.detail;
  $('[data-dialog-title]',dialog).textContent=(currentAccount()?.name||'Cuenta')+' · '+money(detail.sale?.total||0);
  if(!cash.workspace?.shift?.own){
    const accounts=cash.workspace?.shift?.cashAccounts||[];
    body.innerHTML='<div><b>Turno de Caja cerrado</b><p>Abre tu turno para cobrar esta cuenta.</p><div class="demo-bar-payment-fields"><label>Caja<select class="rv2-input" data-cash-account>'+accounts.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.nombre)+'</option>').join('')+'</select></label><label>Base inicial<input class="rv2-input" data-cash-base type="number" min="0" step="100" value="0"></label></div><button class="rv2-btn rv2-btn-primary" data-open-shift '+(accounts.length?'':'disabled')+'>Abrir turno</button></div><div class="demo-bar-dialog-status" data-dialog-status></div>';
    $('[data-open-shift]',body)?.addEventListener('click',openShift);
    return;
  }
  const methods=detail.paymentMethods||[];
  if(!methods.some(m=>String(m.id)===String(cash.methodId)))cash.methodId=methods[0]?.id||null;
  body.innerHTML='<div class="demo-bar-cash-total">'+money(detail.sale?.total||0)+'</div><div class="demo-bar-payment-methods">'+methods.map(m=>'<button class="demo-bar-method '+(String(m.id)===String(cash.methodId)?'active':'')+'" data-cash-method="'+esc(m.id)+'"><b>'+esc(m.name)+'</b><span>'+esc(m.kind)+'</span></button>').join('')+'</div><div class="demo-bar-payment-fields"><label>Propina<input class="rv2-input" data-cash-tip type="number" min="0" step="100" value="0"></label><label>Referencia<input class="rv2-input" data-cash-reference maxlength="160" placeholder="Opcional"></label></div><button class="rv2-btn rv2-btn-primary" data-charge>Confirmar cobro</button><div class="demo-bar-dialog-status" data-dialog-status></div>';
  $$('[data-cash-method]',body).forEach(btn=>btn.onclick=()=>{cash.methodId=btn.dataset.cashMethod;renderCash()});
  $('[data-charge]',body).onclick=charge;
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
  const method=cash.detail.paymentMethods.find(m=>String(m.id)===String(cash.methodId));if(!method)return;
  if(!confirm('Cobrar '+money(cash.detail.sale?.total||0)+' con '+method.name+'?'))return;
  cash.busy=true;dialogStatus('Registrando cobro…');
  try{
    const dialog=$('#demoBarDialog'),tip=Number($('[data-cash-tip]',dialog)?.value||0),reference=$('[data-cash-reference]',dialog)?.value?.trim()||null;
    const data=await RV2.api('/api/v1/restaurante/v2/demo-bar/cuentas/'+encodeURIComponent(S.accountId)+'/cobrar',{method:'POST',body:JSON.stringify({paymentMethodId:method.id,tipAmount:tip,reference})});
    renderCashResult(data);
  }catch(error){dialogStatus(error.message||'No fue posible cobrar.',true)}
  finally{cash.busy=false}
}
function renderCashResult(data){
  const dialog=$('#demoBarDialog'),body=$('[data-dialog-body]',dialog),sessionId=data?.result?.session?.id||null,saleNumber=data?.result?.sale?.numero||'POS';
  body.innerHTML='<div><small>VENTA LIQUIDADA</small><h2>'+esc(saleNumber)+'</h2><p>La cuenta quedó pagada. ¿Deseas imprimir?</p><div class="demo-bar-print-actions"><button class="rv2-btn rv2-btn-primary" data-print>Sí, imprimir</button><button class="rv2-btn" data-no-print>No</button></div><div class="demo-bar-dialog-status" data-dialog-status></div></div>';
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
  const title=$('.rv2-order-top h1');if(title)title.textContent='Pedidos';
  const line=$('#tenantLine');if(line)line.textContent=(session.tenant?.nombreEmpresa||session.subdomain)+' · comportamiento VANTIX BAR';
  $('#refresh')?.addEventListener('click',()=>loadBase(true));
  window.addEventListener('vantix:tenant-realtime',realtime);
  loadBase(false);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.VantixDemoRestaurantBarOrdersV1=Object.freeze({marker:MARKER,tenant:TENANT,refresh:()=>loadBase(true)});
})();