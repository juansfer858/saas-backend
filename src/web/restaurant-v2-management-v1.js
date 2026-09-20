/* VANTIX_RESTAURANT_MANAGEMENT_V1 */
(()=>{'use strict';
const V=window.RestaurantV2;if(!V)throw new Error('Restaurant V2 SDK no disponible');
const session=V.requireSession();
if(String(session?.subdomain||'').trim().toLowerCase()!=='demo-restaurante'){location.replace('/app/centro-de-control-v2');return}
const $=(q,r=document)=>r.querySelector(q),$$=(q,r=document)=>[...r.querySelectorAll(q)],esc=V.esc,money=V.money;
const S={tab:'sales',sales:null,customers:[],suppliers:null,paymentContext:null};
const today=()=>{const d=new Date();return[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const monthStart=()=>{const d=new Date();return[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),'01'].join('-')};
const dt=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short'}).format(d)};
const day=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeZone:'UTC'}).format(d)};
function notice(text,error=false){const n=$('#notice');if(!n)return;n.textContent=text||'';n.classList.toggle('error',error);n.hidden=!text}
function err(id,text=''){const n=$(id);if(!n)return;n.textContent=text||'';n.hidden=!text}
function csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s}
function downloadCsv(name,heads,rows){const body=[heads,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n');const b=new Blob(['\ufeff'+body],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0)}
function setTab(tab){S.tab=tab;$$('[data-mg-tab]').forEach(b=>b.classList.toggle('active',b.dataset.mgTab===tab));$('#salesPanel').hidden=tab!=='sales';$('#customersPanel').hidden=tab!=='customers';$('#suppliersPanel').hidden=tab!=='suppliers';if(tab==='sales'&&!S.sales)loadSales();if(tab==='customers'&&!S.customers.length)loadCustomers();if(tab==='suppliers'&&!S.suppliers)loadSuppliers()}

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
function bind(){
 $('#salesFrom').value=monthStart();$('#salesTo').value=today();
 $$('[data-mg-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.mgTab));
 $('#loadSales').onclick=loadSales;$('#exportSales').onclick=()=>{if(!S.sales)return;downloadCsv('Ventas_'+$('#salesFrom').value+'_'+$('#salesTo').value+'.csv',['Venta','Fecha','Canal','Cuenta','Cliente','Medio','Total'],S.sales.rows.map(r=>[r.number,r.created,r.channel,r.name,r.customer,r.paymentMethod,r.total]))};
 $('#findCustomers').onclick=loadCustomers;$('#customerSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();loadCustomers()}};$('#newCustomer').onclick=()=>openCustomer();
 $('#customerForm').onsubmit=async e=>{e.preventDefault();err('#customerError');try{const body={id:$('#customerId').value||undefined,version:$('#customerVersion').value?Number($('#customerVersion').value):undefined,name:$('#customerName').value.trim(),documentType:$('#customerDocumentType').value,document:$('#customerDocument').value.trim(),phone:$('#customerPhone').value.trim(),email:$('#customerEmail').value.trim(),address:$('#customerAddress').value.trim()};await V.api('/api/v1/restaurante/gestion-v1/clientes',{method:'POST',body:JSON.stringify(body)});$('#customerDialog').close();await loadCustomers();notice('Cliente guardado.')}catch(x){err('#customerError',x.message)}};
 $('#newSupplier').onclick=()=>openSupplier();$('#payableFilter').onchange=renderSuppliers;
 $('#supplierForm').onsubmit=async e=>{e.preventDefault();err('#supplierError');try{await V.api('/api/v1/restaurante/gestion-v1/proveedores',{method:'POST',body:JSON.stringify({id:$('#supplierId').value||undefined,name:$('#supplierName').value.trim(),nit:$('#supplierNit').value.trim(),contact:$('#supplierContact').value.trim(),phone:$('#supplierPhone').value.trim(),email:$('#supplierEmail').value.trim(),address:$('#supplierAddress').value.trim(),termsDays:Number($('#supplierTerms').value||0),active:$('#supplierActive').checked})});$('#supplierDialog').close();await loadSuppliers();notice('Proveedor guardado.')}catch(x){err('#supplierError',x.message)}};
 $$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close)?.close());
 $('#refresh').onclick=()=>{if(S.tab==='sales')loadSales();else if(S.tab==='customers')loadCustomers();else loadSuppliers()};
}
async function boot(){bind();$('#tenantLine').textContent=(session.tenant?.nombreEmpresa||session.subdomain)+' · Ventas · Clientes · Proveedores';setTab('sales')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();