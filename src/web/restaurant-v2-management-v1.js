/* VANTIX_RESTAURANT_MANAGEMENT_V1 */
(()=>{'use strict';
const V=window.RestaurantV2;if(!V)throw new Error('Restaurant V2 SDK no disponible');
const session=V.requireSession();
if(String(session?.subdomain||'').trim().toLowerCase()!=='demo-restaurante'){location.replace('/app/centro-de-control-v2');return}
const $=(q,r=document)=>r.querySelector(q),$$=(q,r=document)=>[...r.querySelectorAll(q)],esc=V.esc,money=V.money;
const S={tab:'sales',sales:null,customers:[],suppliers:null,paymentContext:null,qrs:[]};
const today=()=>{const d=new Date();return[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const monthStart=()=>{const d=new Date();return[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),'01'].join('-')};
const dt=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short'}).format(d)};
const day=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeZone:'UTC'}).format(d)};
function notice(text,error=false){const n=$('#notice');if(!n)return;n.textContent=text||'';n.classList.toggle('error',error);n.hidden=!text}
function err(id,text=''){const n=$(id);if(!n)return;n.textContent=text||'';n.hidden=!text}
function csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s}
function downloadCsv(name,heads,rows){const body=[heads,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n');const b=new Blob(['\ufeff'+body],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0)}
function setTab(tab){S.tab=['sales','customers','suppliers','qrs'].includes(tab)?tab:'sales';$$('[data-mg-tab]').forEach(b=>b.classList.toggle('active',b.dataset.mgTab===S.tab));$('#salesPanel').hidden=S.tab!=='sales';$('#customersPanel').hidden=S.tab!=='customers';$('#suppliersPanel').hidden=S.tab!=='suppliers';$('#qrsPanel').hidden=S.tab!=='qrs';if(S.tab==='sales'&&!S.sales)loadSales();if(S.tab==='customers'&&!S.customers.length)loadCustomers();if(S.tab==='suppliers'&&!S.suppliers)loadSuppliers();if(S.tab==='qrs'&&!S.qrs.length)loadQrs()}

async function loadSales(){
 try{
  notice('Consultando ventas…');const from=$('#salesFrom').value,to=$('#salesTo').value;
  S.sales=await V.api('/api/v1/restaurante/gestion-v1/ventas?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to));
  const summary=S.sales.summary||{},products=summary.products||[];
  $('#salesMetrics').innerHTML=[['Ventas cobradas',summary.sales||0],['Total',money(summary.total||0)],['Productos distintos',products.length],['Período',from+' → '+to]].map(x=>'<article class="mg-metric"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></article>').join('');
  $('#salesRows').innerHTML=(S.sales.rows||[]).length?S.sales.rows.map(r=>'<tr data-sale="'+esc(r.id)+'"><td><button class="rv2-btn" type="button">#'+esc(r.number||'—')+'</button></td><td>'+esc(dt(r.created))+'</td><td><b>'+esc(r.name)+'</b><br><small>'+esc(r.channel)+'</small></td><td>'+esc(r.customer)+'</td><td>'+esc(r.paymentMethod||'—')+'</td><td><b>'+money(r.total)+'</b></td></tr>').join(''):'<tr><td colspan="6"><div class="mg-empty">No hay ventas en este período.</div></td></tr>';
  $('#salesProducts').innerHTML=products.length?'<div class="mg-product-list">'+products.slice(0,80).map(p=>'<article class="mg-product-card"><b>'+esc(p.name)+'</b><span>'+esc(p.qty)+' unidades · '+money(p.total)+'</span></article>').join('')+'</div>':'<div class="mg-empty">Sin productos vendidos en el período.</div>';
  $$('[data-sale]').forEach(row=>row.onclick=()=>openSale(row.dataset.sale));notice('');
 }catch(e){notice(e.message||'No fue posible cargar ventas.',true)}
}
function openSale(id){
 const r=(S.sales?.rows||[]).find(x=>x.id===id);if(!r)return;
 $('#saleTitle').textContent='Venta #'+(r.number||'');
 $('#saleBody').innerHTML='<div class="mg-payline"><span>'+esc(r.name)+' · '+esc(r.customer)+'</span><strong>'+money(r.total)+'</strong></div><div class="mg-table-wrap"><table class="mg-table"><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead><tbody>'+r.detail.lines.map(l=>'<tr><td>'+esc(l.name)+'</td><td>'+esc(l.qty)+'</td><td>'+money(l.price)+'</td><td>'+money(l.total)+'</td></tr>').join('')+'</tbody></table></div>';
 $('#saleDialog').showModal();
}

async function loadCustomers(){
 try{notice('Cargando clientes…');S.customers=await V.api('/api/v1/restaurante/gestion-v1/clientes?q='+encodeURIComponent($('#customerSearch').value||''));renderCustomers();notice('')}catch(e){notice(e.message,true)}
}
function renderCustomers(){$('#customerRows').innerHTML=S.customers.length?S.customers.map(c=>'<tr><td><b>'+esc(c.name)+'</b></td><td>'+esc((c.documentType||'')+' '+(c.document||''))+'</td><td>'+esc(c.phone||'—')+'</td><td>'+esc(c.email||'—')+'</td><td><button class="rv2-btn" data-customer="'+esc(c.id)+'" type="button">Editar</button></td></tr>').join(''):'<tr><td colspan="5"><div class="mg-empty">No hay clientes para este filtro.</div></td></tr>';$$('[data-customer]').forEach(b=>b.onclick=()=>openCustomer(S.customers.find(c=>c.id===b.dataset.customer)))}
function openCustomer(c=null){
 $('#customerId').value=c?.id||'';$('#customerVersion').value=c?.version||'';$('#customerTitle').textContent=c?'Editar cliente':'Crear cliente';$('#customerName').value=c?.name||'';$('#customerDocumentType').value=c?.documentType||'';$('#customerDocument').value=c?.document||'';$('#customerPhone').value=c?.phone||'';$('#customerEmail').value=c?.email||'';$('#customerAddress').value=c?.address||'';err('#customerError');$('#customerDialog').showModal()
}

async function loadSuppliers(){
 try{notice('Cargando proveedores…');S.suppliers=await V.api('/api/v1/restaurante/gestion-v1/proveedores');S.paymentContext=await V.api('/api/v1/restaurante/gestion-v1/contexto-pagos');renderSuppliers();notice('')}catch(e){notice(e.message,true)}
}
function payableState(p){if(p.status==='paid')return['Pagada',''];if(p.status==='void')return['Anulada','out'];const overdue=String(p.dueDate).slice(0,10)<today();return[overdue?'Vencida':'Pendiente',overdue?'out':'low']}
function renderSuppliers(){
 const suppliers=S.suppliers?.suppliers||[],all=S.suppliers?.payables||[],open=all.filter(p=>p.status==='open'),overdue=open.filter(p=>String(p.dueDate).slice(0,10)<today()),balance=open.reduce((s,p)=>s+Number(p.balance||0),0);
 $('#supplierMetrics').innerHTML=[['Proveedores activos',suppliers.filter(s=>s.active).length],['Cuentas pendientes',open.length],['Saldo por pagar',money(balance)],['Vencidas',overdue.length]].map(x=>'<article class="mg-metric"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></article>').join('');
 $('#supplierRows').innerHTML=suppliers.length?suppliers.map(s=>'<tr><td><b>'+esc(s.name)+'</b><br><small>'+(s.active?'Activo':'Inactivo')+'</small></td><td>'+esc(s.nit||'—')+'</td><td>'+esc(s.phone||s.email||s.contact||'—')+'</td><td>'+esc(s.termsDays)+' días</td><td>'+esc(s.openCount)+'</td><td>'+money(s.balance)+'</td><td><button class="rv2-btn" data-supplier="'+esc(s.id)+'" type="button">Editar</button></td></tr>').join(''):'<tr><td colspan="7"><div class="mg-empty">No hay proveedores.</div></td></tr>';
 const filter=$('#payableFilter').value;const rows=all.filter(p=>filter==='all'||(filter==='open'&&p.status==='open')||(filter==='overdue'&&p.status==='open'&&String(p.dueDate).slice(0,10)<today()));
 $('#payableRows').innerHTML=rows.length?rows.map(p=>{const st=payableState(p);return'<tr><td>'+esc(p.supplierName)+'</td><td>'+esc(p.document||'—')+'</td><td>'+esc(day(p.issueDate))+'</td><td>'+esc(day(p.dueDate))+'</td><td>'+money(p.total)+'</td><td><b>'+money(p.balance)+'</b></td><td><span class="mg-status '+st[1]+'">'+esc(st[0])+'</span></td><td><button class="rv2-btn" data-payable="'+esc(p.id)+'" type="button">Ver</button></td></tr>'}).join(''):'<tr><td colspan="8"><div class="mg-empty">Sin cuentas en este filtro.</div></td></tr>';
 $$('[data-supplier]').forEach(b=>b.onclick=()=>openSupplier(suppliers.find(s=>s.id===b.dataset.supplier)));
 $$('[data-payable]').forEach(b=>b.onclick=()=>openPayable(b.dataset.payable));
}
function openSupplier(s=null){$('#supplierId').value=s?.id||'';$('#supplierTitle').textContent=s?'Editar proveedor':'Crear proveedor';$('#supplierName').value=s?.name||'';$('#supplierNit').value=s?.nit||'';$('#supplierContact').value=s?.contact||'';$('#supplierPhone').value=s?.phone||'';$('#supplierEmail').value=s?.email||'';$('#supplierAddress').value=s?.address||'';$('#supplierTerms').value=s?.termsDays||0;$('#supplierActive').checked=s?.active!==false;err('#supplierError');$('#supplierDialog').showModal()}
async function openPayable(id){
 try{
  const p=await V.api('/api/v1/restaurante/gestion-v1/cuentas/'+encodeURIComponent(id));$('#payableTitle').textContent='Cuenta #'+p.number+' · '+p.supplier.name;
  const canPay=p.status==='open'&&Number(p.balance)>0,ctx=S.paymentContext||{banks:[]};const options=[...(ctx.cash?[{id:ctx.cash.id,name:'Efectivo · '+ctx.cash.name,method:'EFECTIVO'}]:[]),...(ctx.banks||[]).flatMap(b=>[{id:b.id,name:'Transferencia · '+b.name,method:'TRANSFERENCIA'},{id:b.id,name:'Tarjeta · '+b.name,method:'TARJETA'}])];
  $('#payableBody').innerHTML='<div class="mg-payline"><span>Saldo pendiente</span><strong>'+money(p.balance)+'</strong></div><p>Documento: <b>'+esc(p.document||'—')+'</b><br>Fecha: '+esc(day(p.issueDate))+' · Vence: '+esc(day(p.dueDate))+'</p><div class="mg-payments">'+(p.payments.length?p.payments.map(x=>'<div class="mg-payment"><span>'+esc(dt(x.creadoEn))+'</span><b>'+money(x.amount)+'</b><span>'+esc(x.method)+' · '+esc(x.note||'')+'</span></div>').join(''):'<div class="mg-empty">Sin pagos registrados.</div>')+'</div>'+(canPay?'<hr><label>Valor<input id="payableAmount" class="mg-input" type="number" min="1" step="1" max="'+esc(p.balance)+'" value="'+esc(p.balance)+'"></label><label>Medio / cuenta<select id="payableAccount" class="mg-select">'+options.map(o=>'<option value="'+esc(o.id)+'" data-method="'+esc(o.method)+'">'+esc(o.name)+'</option>').join('')+'</select></label><label>Observación<input id="payableNote" class="mg-input" maxlength="300"></label><div class="mg-dialog-actions"><button id="payablePay" class="rv2-btn rv2-btn-primary" type="button">Registrar pago</button><button id="payableVoid" class="rv2-btn" type="button">Anular cuenta</button></div>':'');
  if(canPay){
   $('#payablePay').onclick=async()=>{try{const sel=$('#payableAccount'),op=sel.selectedOptions[0];if(!op)throw new Error('No hay una cuenta de pago disponible.');await V.api('/api/v1/restaurante/gestion-v1/cuentas/'+encodeURIComponent(id)+'/pagar',{method:'POST',body:JSON.stringify({amount:Number($('#payableAmount').value),method:op.dataset.method,cajaBancoId:sel.value,note:$('#payableNote').value.trim()})});$('#payableDialog').close();await loadSuppliers();notice('Pago a proveedor registrado.')}catch(e){notice(e.message,true)}};
   $('#payableVoid').onclick=async()=>{if(!confirm('¿Anular esta cuenta por pagar?'))return;try{await V.api('/api/v1/restaurante/gestion-v1/cuentas/'+encodeURIComponent(id)+'/anular',{method:'POST',body:'{}'});$('#payableDialog').close();await loadSuppliers();notice('Cuenta anulada.')}catch(e){notice(e.message,true)}};
  }
  $('#payableDialog').showModal();
 }catch(e){notice(e.message,true)}
}
async function loadQrs(){
 try{
  notice('Cargando QR de mesas…');
  S.qrs=await V.api('/api/v1/restaurante/qrs');if(!Array.isArray(S.qrs))S.qrs=[];
  const filter=$('#qrZoneFilter'),current=filter.value||'ALL';
  const zones=[...new Map(S.qrs.map(row=>[row.zoneId||'NONE',row.zoneName||'Sin zona'])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'es'));
  filter.innerHTML='<option value="ALL">Todas las zonas</option>'+zones.map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('');
  filter.value=[...filter.options].some(o=>o.value===current)?current:'ALL';
  renderQrs();notice('');
 }catch(e){notice(e.message||'No fue posible cargar los QR.',true)}
}
function visibleQrs(){const zone=$('#qrZoneFilter').value||'ALL';return zone==='ALL'?S.qrs:S.qrs.filter(row=>(row.zoneId||'NONE')===zone)}
function renderQrs(){
 const rows=visibleQrs(),zoneCount=new Set(S.qrs.map(row=>row.zoneId||'NONE')).size;
 $('#qrSummary').innerHTML=[
  ['QR totales',S.qrs.length,'mesas físicas'],
  ['Zonas',zoneCount,'organización del salón'],
  ['Visibles',rows.length,$('#qrZoneFilter').selectedOptions[0]?.textContent||'filtro'],
  ['Regeneración','Manual','sólo cuando sea necesario']
 ].map(x=>'<article class="mg-metric"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b><small>'+esc(x[2])+'</small></article>').join('');
 $('#qrGrid').innerHTML=rows.length?rows.map(row=>'<article class="mg-qr-card"><div class="mg-qr-card-head"><div><h3>'+esc(row.tableName)+'</h3><small>'+esc(row.zoneName||'Sin zona')+' · '+esc(row.tableCode||'')+'</small></div><span class="mg-qr-chip">FÍSICO</span></div><div class="mg-qr-code">'+(row.svg||'')+'</div><div class="mg-qr-url">'+esc(row.url||'')+'</div><div class="mg-qr-card-actions"><button class="rv2-btn" type="button" data-print-qr="'+esc(row.tableId)+'">Imprimir</button><a class="rv2-btn" href="'+esc(row.url||'#')+'" target="_blank" rel="noopener">Probar</a><button class="rv2-btn mg-danger" type="button" data-regenerate-qr="'+esc(row.tableId)+'">Regenerar</button></div></article>').join(''):'<div class="mg-empty">No hay QR en este filtro.</div>';
 $$('[data-print-qr]').forEach(btn=>btn.onclick=()=>{const row=S.qrs.find(x=>x.tableId===btn.dataset.printQr);if(row)printQrMaterials([row],'QR '+row.tableName)});
 $$('[data-regenerate-qr]').forEach(btn=>btn.onclick=()=>regenerateQr(btn.dataset.regenerateQr));
}
function printQrMaterials(rows,title){
 if(!rows?.length){notice('No hay QR para imprimir.',true);return}
 const popup=window.open('','_blank');if(!popup){notice('El navegador bloqueó la ventana de impresión. Habilita ventanas emergentes.',true);return}
 popup.opener=null;
 const cards=rows.map(row=>'<article><div class="name">'+esc(row.tableName)+'</div><div class="zone">'+esc(row.zoneName||'Sin zona')+'</div><div class="qr">'+(row.svg||'')+'</div><div class="hint">Escanea para ver la carta y pedir desde esta mesa</div></article>').join('');
 popup.document.open();popup.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>@page{margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;color:#111}.sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:10mm}article{break-inside:avoid;border:1px solid #bbb;border-radius:10px;padding:8mm;text-align:center}.name{font-size:22px;font-weight:800}.zone{margin-top:3px;font-size:12px;color:#555}.qr{display:grid;place-items:center;margin:5mm auto}.qr svg{width:58mm;height:58mm}.hint{font-size:11px;color:#444}@media(max-width:700px){.sheet{grid-template-columns:1fr}}</style></head><body><div class="sheet">'+cards+'</div><script>window.addEventListener("load",()=>setTimeout(()=>window.print(),80));<\/script></body></html>');popup.document.close();
}
async function regenerateQr(tableId){
 const row=S.qrs.find(x=>x.tableId===tableId);if(!row)return;
 if(!confirm('¿Regenerar el QR de '+row.tableName+'?\n\nEl QR físico impreso actualmente dejará de funcionar y deberá imprimirse de nuevo.'))return;
 try{
  notice('Regenerando QR de '+row.tableName+'…');
  const updated=await V.api('/api/v1/restaurante/mesas/'+encodeURIComponent(tableId)+'/qr/regenerar',{method:'POST',body:'{}'});
  S.qrs=S.qrs.map(x=>x.tableId===tableId?updated:x);renderQrs();notice('QR de '+row.tableName+' regenerado. Imprime el nuevo código.');
 }catch(e){notice(e.message||'No fue posible regenerar el QR.',true)}
}

function bind(){
 $('#salesFrom').value=monthStart();$('#salesTo').value=today();
 $$('[data-mg-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.mgTab));
 $('#qrZoneFilter').onchange=renderQrs;$('#printVisibleQrs').onclick=()=>printQrMaterials(visibleQrs(),'QR '+($('#qrZoneFilter').selectedOptions[0]?.textContent||'visibles'));$('#printAllQrs').onclick=()=>printQrMaterials(S.qrs,'Todos los QR de mesas');
 $('#loadSales').onclick=loadSales;$('#exportSales').onclick=()=>{if(!S.sales)return;downloadCsv('Ventas_'+$('#salesFrom').value+'_'+$('#salesTo').value+'.csv',['Venta','Fecha','Canal','Cuenta','Cliente','Medio','Total'],S.sales.rows.map(r=>[r.number,r.created,r.channel,r.name,r.customer,r.paymentMethod,r.total]))};
 $('#findCustomers').onclick=loadCustomers;$('#customerSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();loadCustomers()}};$('#newCustomer').onclick=()=>openCustomer();
 $('#customerForm').onsubmit=async e=>{e.preventDefault();err('#customerError');try{const body={id:$('#customerId').value||undefined,version:$('#customerVersion').value?Number($('#customerVersion').value):undefined,name:$('#customerName').value.trim(),documentType:$('#customerDocumentType').value,document:$('#customerDocument').value.trim(),phone:$('#customerPhone').value.trim(),email:$('#customerEmail').value.trim(),address:$('#customerAddress').value.trim()};await V.api('/api/v1/restaurante/gestion-v1/clientes',{method:'POST',body:JSON.stringify(body)});$('#customerDialog').close();await loadCustomers();notice('Cliente guardado.')}catch(x){err('#customerError',x.message)}};
 $('#newSupplier').onclick=()=>openSupplier();$('#payableFilter').onchange=renderSuppliers;
 $('#supplierForm').onsubmit=async e=>{e.preventDefault();err('#supplierError');try{await V.api('/api/v1/restaurante/gestion-v1/proveedores',{method:'POST',body:JSON.stringify({id:$('#supplierId').value||undefined,name:$('#supplierName').value.trim(),nit:$('#supplierNit').value.trim(),contact:$('#supplierContact').value.trim(),phone:$('#supplierPhone').value.trim(),email:$('#supplierEmail').value.trim(),address:$('#supplierAddress').value.trim(),termsDays:Number($('#supplierTerms').value||0),active:$('#supplierActive').checked})});$('#supplierDialog').close();await loadSuppliers();notice('Proveedor guardado.')}catch(x){err('#supplierError',x.message)}};
 $$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close)?.close());
 $('#refresh').onclick=()=>{if(S.tab==='sales')loadSales();else if(S.tab==='customers')loadCustomers();else if(S.tab==='suppliers')loadSuppliers();else loadQrs()};
}
async function boot(){bind();$('#tenantLine').textContent=(session.tenant?.nombreEmpresa||session.subdomain)+' · Ventas · Clientes · Proveedores · QR de mesas';setTab('sales')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();