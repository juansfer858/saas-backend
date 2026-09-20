/* VANTIX_RESTAURANT_V2_ADMIN_PARITY_V1 */
/* VANTIX_RESTAURANT_V2_HYBRID_STATUS_V84 */
/* VANTIX_RESTAURANT_V2_HYBRID_STATUS_V84_2_REAL_PAYLOAD */
(()=>{'use strict';
  const V=window.RestaurantV2;
  if(!V) throw new Error('Restaurant V2 SDK no disponible');
  const S={context:null,tab:location.pathname.endsWith('/dispositivos')?'devices':'qrs',deviceKind:'waiter',qrs:[],users:[],waiterDevices:[],productionDevices:[],edgeInstallations:[],pairing:null};
  const $=(q)=>document.querySelector(q);const $$=(q)=>[...document.querySelectorAll(q)];const esc=V.esc;
  const roleLabel=(role)=>role==='MESERO'?'Mesero':role==='COCINA'?'Cocina':role==='BARRA'?'Barra':role==='POSTRES'?'Postres':String(role||'Producción');
  const dateText=(value)=>{if(!value)return 'Sin registro';const d=new Date(value);return Number.isNaN(d.getTime())?'Sin registro':new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short'}).format(d)};
  function notice(text,type=''){const node=$('#notice');node.textContent=text||'';node.className=`admin-notice ${type}`.trim()}
  function adminAllowed(){return V.can(S.context,'RESTAURANTE.ADMINISTRAR')}
  async function boot(){
    try{
      S.context=await V.api('/api/v1/restaurante/ui-context');
      const session=V.requireSession();
      $('#tenantLine').textContent=`${S.context?.theme?.restaurantName||session.tenant?.nombreEmpresa||'Restaurante'} · ${session.subdomain}`;
      if(!adminAllowed()){notice('Sólo Administrador puede gestionar QR y dispositivos.','error');return}
      bindStatic();setTab(S.tab,false);await refreshCurrent();
    }catch(error){notice(error.message,'error')}
  }
  function bindStatic(){
    $$('[data-admin-tab]').forEach(btn=>btn.addEventListener('click',()=>setTab(btn.dataset.adminTab,true)));
    $$('[data-device-kind]').forEach(btn=>btn.addEventListener('click',()=>{S.deviceKind=btn.dataset.deviceKind;renderDevices()}));
    $('#refresh').addEventListener('click',()=>refreshCurrent());
    $('#refreshDevices').addEventListener('click',()=>loadDevices(true));
    $('#qrZoneFilter').addEventListener('change',renderQrs);
    $('#printVisibleQrs').addEventListener('click',()=>printMaterials(visibleQrs(),`QR ${$('#qrZoneFilter').selectedOptions[0]?.textContent||'visibles'}`));
    $('#printAllQrs').addEventListener('click',()=>printMaterials(S.qrs,'Todos los QR de mesas'));
    $('#generatePairing').addEventListener('click',generatePairing);
    $('[data-close-dialog]').addEventListener('click',()=>$('#pairingDialog').close());
    $('#pairingDialog').addEventListener('click',(event)=>{if(event.target===$('#pairingDialog'))$('#pairingDialog').close()});
  }
  function setTab(tab,push){
    S.tab=tab==='devices'?'devices':'qrs';
    $$('[data-admin-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.adminTab===S.tab));
    $('#qrsPanel').hidden=S.tab!=='qrs';$('#devicesPanel').hidden=S.tab!=='devices';
    $('#pageTitle').textContent=S.tab==='qrs'?'QR de mesas':'Dispositivos';
    if(push){const target=S.tab==='qrs'?'/app/restaurante-v2/qrs':'/app/restaurante-v2/dispositivos';history.replaceState({...(history.state||{}),restaurantV2AdminTab:S.tab},'',target)}
  }
  async function refreshCurrent(){
    notice('Actualizando…');
    try{if(S.tab==='qrs')await loadQrs();else await loadDevices();notice('Información actualizada.','ok')}catch(error){notice(error.message,'error')}
  }
  async function loadQrs(){
    S.qrs=await V.api('/api/v1/restaurante/qrs');if(!Array.isArray(S.qrs))S.qrs=[];
    const current=$('#qrZoneFilter').value||'ALL';
    const zones=[...new Map(S.qrs.map(row=>[row.zoneId||'NONE',row.zoneName||'Sin zona'])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'es'));
    $('#qrZoneFilter').innerHTML='<option value="ALL">Todas las zonas</option>'+zones.map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');
    $('#qrZoneFilter').value=[...$('#qrZoneFilter').options].some(o=>o.value===current)?current:'ALL';
    renderQrs();
  }
  function visibleQrs(){const zone=$('#qrZoneFilter').value||'ALL';return zone==='ALL'?S.qrs:S.qrs.filter(row=>(row.zoneId||'NONE')===zone)}
  function renderQrs(){
    const rows=visibleQrs();const zoneCount=new Set(S.qrs.map(row=>row.zoneId||'NONE')).size;
    $('#qrSummary').innerHTML=[['QR totales',S.qrs.length,'Tokens físicos actuales'],['Zonas',zoneCount,'Organización del salón'],['Visibles',rows.length,$('#qrZoneFilter').selectedOptions[0]?.textContent||'Filtro'],['Rotados',0,'Sólo cambian con “Regenerar”']].map(([a,b,c])=>`<div class="summary-card"><small>${esc(a)}</small><strong>${esc(b)}</strong><span>${esc(c)}</span></div>`).join('');
    $('#qrGrid').innerHTML=rows.length?rows.map(row=>`<article class="qr-card" data-qr-table="${esc(row.tableId)}"><div class="qr-card-head"><div><h3>${esc(row.tableName)}</h3><small>${esc(row.zoneName||'Sin zona')} · ${esc(row.tableCode||'')}</small></div><span class="role-chip">FÍSICO</span></div><div class="qr-code">${row.svg||''}</div><div class="qr-url">${esc(row.url||'')}</div><div class="qr-actions"><button class="rv2-btn" type="button" data-print-qr="${esc(row.tableId)}">Imprimir</button><a class="rv2-btn" href="${esc(row.url||'#')}" target="_blank" rel="noopener">Probar QR</a><button class="rv2-btn danger" type="button" data-regenerate-qr="${esc(row.tableId)}">Regenerar</button></div></article>`).join(''):'<div class="empty">No hay QR en este filtro.</div>';
    $$('[data-print-qr]').forEach(btn=>btn.addEventListener('click',()=>{const row=S.qrs.find(x=>x.tableId===btn.dataset.printQr);if(row)printMaterials([row],`QR ${row.tableName}`)}));
    $$('[data-regenerate-qr]').forEach(btn=>btn.addEventListener('click',()=>regenerateQr(btn.dataset.regenerateQr)));
  }
  function printMaterials(rows,title){
    if(!rows?.length){notice('No hay QR para imprimir.','error');return}
    const popup=window.open('','_blank');if(!popup){notice('El navegador bloqueó la ventana de impresión. Habilita ventanas emergentes para este sitio.','error');return}popup.opener=null;
    const cards=rows.map(row=>`<article><div class="name">${esc(row.tableName)}</div><div class="zone">${esc(row.zoneName||'Sin zona')}</div><div class="qr">${row.svg||''}</div><div class="hint">Escanea para ver la carta y pedir desde esta mesa</div></article>`).join('');
    popup.document.open();popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;color:#111}.sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:10mm}article{break-inside:avoid;border:1px solid #bbb;border-radius:10px;padding:8mm;text-align:center}.name{font-size:22px;font-weight:800}.zone{margin-top:3px;font-size:12px;color:#555}.qr{display:grid;place-items:center;margin:5mm auto}.qr svg{width:58mm;height:58mm}.hint{font-size:11px;color:#444}@media(max-width:700px){.sheet{grid-template-columns:1fr}}@media print{button{display:none}}</style></head><body><div class="sheet">${cards}</div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),80));<\/script></body></html>`);popup.document.close();
  }
  async function regenerateQr(tableId){
    const row=S.qrs.find(x=>x.tableId===tableId);if(!row)return;
    if(!confirm(`¿Regenerar el QR de ${row.tableName}?\n\nEl QR físico impreso actualmente dejará de funcionar y deberá imprimirse de nuevo.`))return;
    try{notice(`Regenerando QR de ${row.tableName}…`);const updated=await V.api(`/api/v1/restaurante/mesas/${encodeURIComponent(tableId)}/qr/regenerar`,{method:'POST',body:'{}'});S.qrs=S.qrs.map(x=>x.tableId===tableId?updated:x);renderQrs();notice(`QR de ${row.tableName} regenerado. Imprime el nuevo código antes de usar esa mesa.`, 'ok')}catch(error){notice(error.message,'error')}
  }
  async function loadDevices(silent=false){
    if(!silent)notice('Cargando empleados y dispositivos…');
    const [users,waiterDevices,productionDevices]=await Promise.all([V.api('/api/v1/usuarios'),V.api('/api/v1/restaurante/dispositivos-mesero'),V.api('/api/v1/restaurante/dispositivos-produccion')]);
    S.users=Array.isArray(users)?users:[];S.waiterDevices=Array.isArray(waiterDevices)?waiterDevices:[];S.productionDevices=Array.isArray(productionDevices)?productionDevices:[];renderDevices();await loadHybridState();if(!silent)notice('Dispositivos actualizados.','ok')
  }
  function edgeOnline(row){
    if(row?.installation?.online===true||row?.online===true)return true;
    return String(row?.heartbeat||row?.agent?.heartbeat||'').toUpperCase()==='ONLINE';
  }
  function edgeVersion(row){return row?.installation?.softwareVersion||row?.agent?.softwareVersion||row?.agent?.version||row?.version||'Sin versión reportada'}
  function edgeLastSeen(row){return row?.installation?.lastHeartbeatAt||row?.lastHeartbeatAt||row?.agent?.lastSeenAt||null}
  function edgePlatform(row){
    const installation=row?.installation||{};
    return [installation.os||row?.platform,installation.architecture||row?.arch].filter(Boolean).join(' · ')||'Plataforma no reportada';
  }
  function edgeHeartbeatLabel(row){
    if(edgeOnline(row))return 'EN LÍNEA';
    return edgeLastSeen(row)?'SIN RESPUESTA':'SIN REGISTRO';
  }
  function focusHybridState(){if(S.tab!=='devices'||location.hash!=='#estado-local-nube')return;requestAnimationFrame(()=>$('#estado-local-nube')?.scrollIntoView({block:'start',behavior:'smooth'}))}
  function renderHybridState(){
    const rows=Array.isArray(S.edgeInstallations)?S.edgeInstallations:[];
    const online=rows.find(edgeOnline);
    const selected=online||rows[0]||null;
    const badge=$('#hybridStateBadge');
    $('#hybridCloudStatus').textContent='En línea';
    $('#hybridCloudDetail').textContent='Core disponible · la operación por Internet está activa.';
    badge.className='hybrid-state-badge';
    if(online){
      badge.classList.add('online');badge.textContent='EDGE EN LÍNEA';
      $('#hybridEdgeStatus').textContent='En línea';
      $('#hybridEdgeDetail').textContent='El acceso local está reportando heartbeat al Core.';
    }else if(rows.length){
      badge.classList.add('offline');badge.textContent='EDGE SIN CONEXIÓN';
      $('#hybridEdgeStatus').textContent='Sin conexión';
      $('#hybridEdgeDetail').textContent='La nube sigue activa; Edge se sincronizará cuando vuelva.';
    }else{
      badge.classList.add('cloud');badge.textContent='EDGE NO INSTALADO';
      $('#hybridEdgeStatus').textContent='No instalado';
      $('#hybridEdgeDetail').textContent='Este restaurante opera por Internet hasta instalar Edge local.';
    }
    if(selected){
      $('#hybridStateMeta').textContent=`Instalaciones: ${rows.length} · Heartbeat: ${edgeHeartbeatLabel(selected)} · Último contacto: ${dateText(edgeLastSeen(selected))} · ${edgePlatform(selected)} · Edge ${edgeVersion(selected)}`;
    }else $('#hybridStateMeta').textContent='No hay una instalación Edge registrada para este tenant.';
    focusHybridState();
  }
  function renderHybridUnavailable(error){
    const badge=$('#hybridStateBadge');badge.className='hybrid-state-badge';badge.textContent='ESTADO NO DISPONIBLE';
    $('#hybridCloudStatus').textContent='En línea';$('#hybridCloudDetail').textContent='La pantalla continúa conectada al Core.';
    $('#hybridEdgeStatus').textContent='No disponible';$('#hybridEdgeDetail').textContent='No se pudo consultar la telemetría Edge en este momento.';
    $('#hybridStateMeta').textContent=`Consulta Edge: ${error?.message||'sin respuesta'}. Esto no bloquea la operación por nube.`;
    focusHybridState();
  }
  async function loadHybridState(){
    try{const rows=await V.api('/api/v1/edge/installations');S.edgeInstallations=Array.isArray(rows)?rows:[];renderHybridState()}catch(error){S.edgeInstallations=[];renderHybridUnavailable(error)}
  }
  function currentStaff(){return S.deviceKind==='waiter'?S.users.filter(u=>u.activo&&u.rol==='MESERO'):S.users.filter(u=>u.activo&&['COCINA','BARRA','POSTRES'].includes(u.rol))}
  function currentDevices(){return S.deviceKind==='waiter'?S.waiterDevices:S.productionDevices}
  function renderDevices(){
    $$('[data-device-kind]').forEach(btn=>btn.classList.toggle('active',btn.dataset.deviceKind===S.deviceKind));
    const staff=currentStaff(),devices=currentDevices(),active=devices.filter(d=>d.active).length,pending=devices.filter(d=>d.status==='PAIRING').length;
    $('#deviceSummary').innerHTML=[['Personal activo',staff.length,S.deviceKind==='waiter'?'Meseros':'Cocina / Barra / Postres'],['Dispositivos activos',active,'Vinculación persistente'],['Vínculos pendientes',pending,'QR temporal aún vigente'],['Historial',devices.length,'Activos, pendientes y revocados']].map(([a,b,c])=>`<div class="summary-card"><small>${esc(a)}</small><strong>${esc(b)}</strong><span>${esc(c)}</span></div>`).join('');
    $('#staffGrid').innerHTML=staff.length?staff.map(user=>{const linked=devices.filter(d=>(d.waiter?.id||d.user?.id)===user.id&&d.active).length;return `<article class="staff-card"><div class="staff-card-head"><div><h3>${esc(user.nombre)}</h3><p>${esc(user.email||'')}</p></div><span class="role-chip">${esc(roleLabel(user.rol))}</span></div><div class="staff-meta">${linked} dispositivo(s) activo(s)</div><button class="rv2-btn rv2-btn-primary" type="button" data-pair-user="${esc(user.id)}">GENERAR QR DE VINCULACIÓN</button></article>`}).join(''):'<div class="empty">No hay personal activo para este tipo de dispositivo.</div>';
    $$('[data-pair-user]').forEach(btn=>btn.addEventListener('click',()=>{const user=S.users.find(u=>u.id===btn.dataset.pairUser);if(user)openPairing(user)}));
    $('#deviceList').innerHTML=devices.length?devices.map(d=>{const owner=d.waiter||d.user||null;const status=String(d.status||'').toUpperCase();const statusClass=status==='REVOKED'?'revoked':status==='PAIRING'?'pairing':'';const statusText=d.active?'ACTIVO':status==='PAIRING'?'PENDIENTE':status||'INACTIVO';return `<div class="device-row"><div><b>${esc(d.deviceName||'Dispositivo')}</b><br><span>${esc(owner?.nombre||'Empleado no disponible')}</span></div><div><b>${esc(roleLabel(d.station||owner?.rol||'MESERO'))}</b><br><span>Última actividad: ${esc(dateText(d.lastSeenAt))}</span></div><span class="status-chip ${statusClass}">${esc(statusText)}</span>${d.active||status==='PAIRING'?`<button class="rv2-btn danger" type="button" data-revoke-device="${esc(d.id)}">Desautorizar</button>`:'<span></span>'}</div>`}).join(''):'<div class="empty">Todavía no hay dispositivos registrados.</div>';
    $$('[data-revoke-device]').forEach(btn=>btn.addEventListener('click',()=>revokeDevice(btn.dataset.revokeDevice)));
  }
  function openPairing(user){
    S.pairing={kind:S.deviceKind,user};$('#pairingTitle').textContent=`${roleLabel(user.rol)} · ${user.nombre}`;$('#deviceName').value=S.deviceKind==='waiter'?`Tablet ${user.nombre}`:`Tablet ${roleLabel(user.rol)}`;$('#pairingSetup').hidden=false;$('#pairingResult').hidden=true;$('#pairingQr').innerHTML='';$('#pairingDialog').showModal();
  }
  async function generatePairing(){
    if(!S.pairing)return;const button=$('#generatePairing');button.disabled=true;button.textContent='GENERANDO…';
    try{
      const base=S.pairing.kind==='waiter'?'/api/v1/restaurante/dispositivos-mesero/vinculo':'/api/v1/restaurante/dispositivos-produccion/vinculo';
      const data=await V.api(base,{method:'POST',body:JSON.stringify({userId:S.pairing.user.id,deviceName:$('#deviceName').value.trim()||null})});
      $('#pairingSetup').hidden=true;$('#pairingResult').hidden=false;$('#pairingQr').innerHTML=data.svg||'';$('#pairingDeviceName').textContent=data.deviceName||'Dispositivo';$('#pairingExpiry').textContent=`Vence: ${dateText(data.expiresAt)}`;$('#pairingLink').href=data.url||'#';notice(`QR de vinculación creado para ${S.pairing.user.nombre}.`,'ok');await loadDevices(true);
    }catch(error){notice(error.message,'error')}finally{button.disabled=false;button.textContent='GENERAR QR DE VINCULACIÓN'}
  }
  async function revokeDevice(id){
    const devices=currentDevices();const row=devices.find(x=>x.id===id);if(!row)return;if(!confirm(`¿Desautorizar ${row.deviceName||'este dispositivo'}? Tendrá que volver a vincularse con un QR nuevo.`))return;
    try{const base=S.deviceKind==='waiter'?`/api/v1/restaurante/dispositivos-mesero/${encodeURIComponent(id)}`:`/api/v1/restaurante/dispositivos-produccion/${encodeURIComponent(id)}`;await V.api(base,{method:'DELETE'});await loadDevices(true);notice('Dispositivo desautorizado.','ok')}catch(error){notice(error.message,'error')}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

;(()=>{'use strict';
const MARKER='VANTIX_DEMO_RESTAURANTE_PRINT_TEMPLATE_CENTER_V1';
const V=window.RestaurantV2;if(!V)return;
const session=V.readSession?.()||V.requireSession?.();
if(String(session?.subdomain||'').trim().toLowerCase()!=='demo-restaurante')return;
const $=(q,r=document)=>r.querySelector(q);
const $$=(q,r=document)=>[...r.querySelectorAll(q)];
const esc=V.esc;
const T={data:null,company:null,tab:'invoice',timer:null};

function templateStyles(){
  if($('#ptcStyles'))return;
  const s=document.createElement('style');s.id='ptcStyles';
  s.textContent='.ptc{padding:0!important;overflow:hidden}.ptc-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:16px;border-bottom:1px solid #d9e2dd}.ptc-head h2{margin:3px 0;font-size:20px}.ptc-head p{margin:4px 0 0;color:#61706a;font-size:12px}.ptc-tabs{display:flex;gap:7px;flex-wrap:wrap}.ptc-tabs button{min-height:40px;padding:0 13px;border:1px solid #cfd9d3;border-radius:10px;background:#fff;font-weight:900;cursor:pointer}.ptc-tabs button.active{background:#0d6b43;border-color:#0d6b43;color:#fff}.ptc-body{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(320px,.92fr);gap:14px;padding:16px}.ptc-card{border:1px solid #d9e2dd;border-radius:13px;padding:14px;background:#fff}.ptc-card h3{margin:0 0 11px;font-size:15px}.ptc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ptc-field{display:grid;gap:5px;font-size:11px;font-weight:850;color:#34453d}.ptc-field.full{grid-column:1/-1}.ptc-field input,.ptc-preview-head select{min-height:40px;border:1px solid #cfd9d3;border-radius:9px;background:#fff;padding:0 9px;font:inherit}.ptc-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:10px}.ptc-check{display:flex;align-items:center;gap:7px;padding:7px 8px;border:1px solid #e3e9e5;border-radius:9px;background:#fafcfb;font-size:10px;font-weight:750}.ptc-check input{width:16px;height:16px}.ptc-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.ptc-status{min-height:18px;margin-top:8px;font-size:11px;font-weight:800}.ptc-status.ok{color:#166534}.ptc-status.bad{color:#b91c1c}.ptc-preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.ptc-paper{margin:0 auto;max-width:100%;max-height:520px;overflow:auto;padding:16px 11px;background:#fffdf7;border:1px solid #cbd5e1;box-shadow:0 7px 20px rgba(15,23,42,.08);font:700 11px/1.38 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre}.ptc-paper.p58{width:calc(32ch + 24px)}.ptc-paper.p80{width:calc(42ch + 24px)}.ptc-note{margin-top:9px;color:#64748b;font-size:10px;line-height:1.45}.ptc-command{padding:22px;text-align:center;border:1px dashed #b8c8c0;border-radius:12px;background:#f7faf8}.ptc-command b{display:block;font-size:16px}.ptc-command span{display:block;margin:6px 0 13px;color:#61706a;font-size:11px}@media(max-width:850px){.ptc-body{grid-template-columns:1fr}.ptc-grid,.ptc-checks{grid-template-columns:1fr}.ptc-field.full{grid-column:auto}.ptc-head{display:grid}}';
  document.head.appendChild(s);
}
function api(path,options={}){return V.api(path,options)}
function check(id,label,value){return '<label class="ptc-check"><input id="'+id+'" type="checkbox" '+(value?'checked':'')+'> '+esc(label)+'</label>'}
function setStatus(text,kind){const n=$('#ptcStatus');if(n){n.textContent=text||'';n.className='ptc-status '+(kind||'')}}
function invoiceValue(){
  const keys=['showCompanyName','showNit','showAddress','showCity','showPhone','showEmail','showSaleNumber','showTable','showDate','showCustomerName','showCustomerDocument','showCustomerAddress','showCustomerPhone','showCustomerEmail','showUnitPrice','showSubtotal','showDiscount','showTaxes','showTip','showPayment','showReference'];
  const out={title:String($('#ptcInvoiceTitle')?.value||'').trim()||null,thankYouText:String($('#ptcThanks')?.value||'').trim(),footerText:String($('#ptcFooter')?.value||'').trim()};
  keys.forEach(k=>out[k]=Boolean($('#ptc_'+k)?.checked));return out;
}
function closeValue(){return{title:String($('#ptcCloseTitle')?.value||'').trim(),showDetailHint:Boolean($('#ptc_showDetailHint')?.checked),showInternalNote:Boolean($('#ptc_showInternalNote')?.checked),footerText:String($('#ptcCloseFooter')?.value||'').trim()}}
function preview(data,node,paper){if(!node)return;node.className='ptc-paper '+(String(paper).includes('58')?'p58':'p80');node.textContent=[...(data?.lines||[]),data?.footer].filter(Boolean).join('\n')}
async function refreshPreview(kind){
  if(kind==='invoice'){
    const paper=$('#ptcInvoicePaper')?.value||'TERMICA_80',node=$('#ptcInvoicePreview');if(node)node.textContent='Generando vista previa...';
    try{const data=await api('/api/v1/restaurante/plantillas-documentos/factura/preview',{method:'POST',body:JSON.stringify({paperFormat:paper,template:invoiceValue()})});preview(data,node,paper)}catch(e){if(node)node.textContent=e.message||'No fue posible generar la vista previa.'}
  }else{
    const paper=$('#ptcClosePaper')?.value||'TERMICA_80',node=$('#ptcClosePreview');if(node)node.textContent='Generando vista previa...';
    try{const data=await api('/api/v1/restaurante/plantillas-documentos/cierre/preview',{method:'POST',body:JSON.stringify({paperFormat:paper,template:closeValue()})});preview(data,node,paper)}catch(e){if(node)node.textContent=e.message||'No fue posible generar la vista previa.'}
  }
}
function queuePreview(kind){clearTimeout(T.timer);T.timer=setTimeout(()=>refreshPreview(kind),180)}
function invoiceHtml(cfg){
  const title=cfg.title||T.company?.receiptTitle||'COMPROBANTE DE VENTA';
  return '<div class="ptc-body"><section class="ptc-card"><h3>Factura / tirilla POS</h3><div class="ptc-grid">'+
  '<label class="ptc-field full">Título del documento<input id="ptcInvoiceTitle" maxlength="80" value="'+esc(title)+'"></label>'+
  '<label class="ptc-field">Texto de agradecimiento<input id="ptcThanks" maxlength="80" value="'+esc(cfg.thankYouText||'Gracias por su compra')+'"></label>'+
  '<label class="ptc-field">Texto al pie / cuña<input id="ptcFooter" maxlength="96" value="'+esc(cfg.footerText||'')+'" placeholder="VANTIX GC · www.vantixgc.com"></label></div>'+
  '<div class="ptc-checks">'+
  check('ptc_showCompanyName','Nombre del comercio',cfg.showCompanyName)+check('ptc_showNit','NIT',cfg.showNit)+check('ptc_showAddress','Dirección del comercio',cfg.showAddress)+check('ptc_showCity','Ciudad / departamento',cfg.showCity)+check('ptc_showPhone','Teléfono del comercio',cfg.showPhone)+check('ptc_showEmail','Correo del comercio',cfg.showEmail)+
  check('ptc_showSaleNumber','Número de venta',cfg.showSaleNumber)+check('ptc_showTable','Mesa / ubicación',cfg.showTable)+check('ptc_showDate','Fecha y hora',cfg.showDate)+
  check('ptc_showCustomerName','Nombre del cliente',cfg.showCustomerName)+check('ptc_showCustomerDocument','Documento del cliente',cfg.showCustomerDocument)+check('ptc_showCustomerAddress','Dirección del cliente',cfg.showCustomerAddress)+check('ptc_showCustomerPhone','Teléfono del cliente',cfg.showCustomerPhone)+check('ptc_showCustomerEmail','Correo del cliente',cfg.showCustomerEmail)+
  check('ptc_showUnitPrice','Precio unitario',cfg.showUnitPrice)+check('ptc_showSubtotal','Subtotal',cfg.showSubtotal)+check('ptc_showDiscount','Descuentos',cfg.showDiscount)+check('ptc_showTaxes','IVA / impoconsumo',cfg.showTaxes)+check('ptc_showTip','Propina',cfg.showTip)+check('ptc_showPayment','Medio de pago',cfg.showPayment)+check('ptc_showReference','Referencia de pago',cfg.showReference)+
  '</div><div class="ptc-actions"><button class="rv2-btn rv2-btn-primary" id="ptcSaveInvoice" type="button">Guardar factura</button><button class="rv2-btn" id="ptcResetInvoice" type="button">Restaurar recomendada</button><a class="rv2-btn" href="/app/configuracion-avanzada" target="_top">Datos de empresa</a></div><div id="ptcStatus" class="ptc-status"></div></section>'+
  '<aside class="ptc-card"><div class="ptc-preview-head"><b>Vista previa real</b><select id="ptcInvoicePaper"><option value="TERMICA_80">80 mm</option><option value="TERMICA_58">58 mm</option></select></div><pre id="ptcInvoicePreview" class="ptc-paper p80"></pre><div class="ptc-note">Usa el mismo motor que genera la tirilla física. Los datos del comercio se editan en Administración avanzada; aquí decides qué se imprime.</div></aside></div>';
}
function closeHtml(cfg){
  return '<div class="ptc-body"><section class="ptc-card"><h3>Cierre de turno</h3><div class="ptc-grid"><label class="ptc-field full">Título<input id="ptcCloseTitle" maxlength="80" value="'+esc(cfg.title||'CIERRE DE TURNO / CAJA')+'"></label><label class="ptc-field full">Texto al pie<input id="ptcCloseFooter" maxlength="96" value="'+esc(cfg.footerText||'VantixGC · Cierre de caja')+'"></label></div><div class="ptc-checks">'+check('ptc_showDetailHint','Mostrar “Detalle: Historial de cierres”',cfg.showDetailHint)+check('ptc_showInternalNote','Mostrar “Control interno - no es factura”',cfg.showInternalNote)+'</div><div class="ptc-actions"><button class="rv2-btn rv2-btn-primary" id="ptcSaveClose" type="button">Guardar cierre</button><button class="rv2-btn" id="ptcResetClose" type="button">Restaurar recomendado</button></div><div id="ptcStatus" class="ptc-status"></div></section><aside class="ptc-card"><div class="ptc-preview-head"><b>Vista previa real</b><select id="ptcClosePaper"><option value="TERMICA_80">80 mm</option><option value="TERMICA_58">58 mm</option></select></div><pre id="ptcClosePreview" class="ptc-paper p80"></pre><div class="ptc-note">El resumen y sus valores siguen siendo canónicos; sólo se modifica presentación segura.</div></aside></div>';
}
function commandHtml(){return '<div class="ptc-body"><section class="ptc-card"><div class="ptc-command"><b>Comanda de Cocina / Barra / Postres</b><span>Alineación, tamaño, notas, persona, separadores, hora y textos adicionales.</span><button id="ptcOpenCommand" class="rv2-btn rv2-btn-primary" type="button">Editar plantilla de comanda</button></div><div class="ptc-note">Este botón abre el editor V4 ya existente; no se creó otra plantilla.</div></section><aside class="ptc-card"><h3>Qué afecta</h3><div class="ptc-note">Las próximas comandas impresas. Domicilios conserva automáticamente nombre del cliente, teléfono y dirección.</div></aside></div>'}
function renderTemplateTab(){
  const host=$('#ptcBody');if(!host||!T.data)return;
  $$('.ptc-tabs [data-ptc-tab]').forEach(b=>b.classList.toggle('active',b.dataset.ptcTab===T.tab));
  if(T.tab==='invoice'){
    host.innerHTML=invoiceHtml(T.data.invoice);
    host.oninput=()=>queuePreview('invoice');host.onchange=()=>queuePreview('invoice');
    $('#ptcSaveInvoice').onclick=async()=>{try{setStatus('Guardando...');T.data.invoice=await api('/api/v1/restaurante/plantillas-documentos/factura',{method:'PUT',body:JSON.stringify(invoiceValue())});setStatus('Factura guardada. Las próximas impresiones usarán esta plantilla.','ok');refreshPreview('invoice')}catch(e){setStatus(e.message,'bad')}};
    $('#ptcResetInvoice').onclick=async()=>{try{T.data.invoice=await api('/api/v1/restaurante/plantillas-documentos/factura/restaurar',{method:'POST',body:'{}'});renderTemplateTab()}catch(e){setStatus(e.message,'bad')}};
    refreshPreview('invoice');
  }else if(T.tab==='command'){
    host.oninput=null;host.onchange=null;host.innerHTML=commandHtml();
    $('#ptcOpenCommand').onclick=()=>{if(window.RestaurantPrintTemplates?.open)window.RestaurantPrintTemplates.open();else window.dispatchEvent(new Event('vantix:restaurant-print-template:open'))};
  }else{
    host.innerHTML=closeHtml(T.data.cashClose);
    host.oninput=()=>queuePreview('close');host.onchange=()=>queuePreview('close');
    $('#ptcSaveClose').onclick=async()=>{try{setStatus('Guardando...');T.data.cashClose=await api('/api/v1/restaurante/plantillas-documentos/cierre',{method:'PUT',body:JSON.stringify(closeValue())});setStatus('Plantilla de cierre guardada.','ok');refreshPreview('close')}catch(e){setStatus(e.message,'bad')}};
    $('#ptcResetClose').onclick=async()=>{try{T.data.cashClose=await api('/api/v1/restaurante/plantillas-documentos/cierre/restaurar',{method:'POST',body:'{}'});renderTemplateTab()}catch(e){setStatus(e.message,'bad')}};
    refreshPreview('close');
  }
}
async function mountTemplateCenter(){
  const devices=$('#devicesPanel');if(!devices||$('#printTemplateCenter'))return;
  templateStyles();
  const section=document.createElement('section');section.id='printTemplateCenter';section.className='rv2-panel ptc';section.dataset.printTemplateCenter=MARKER;
  section.innerHTML='<div class="ptc-head"><div><small>IMPRESIÓN</small><h2>Plantillas de impresión</h2><p>Factura, comanda y cierre de turno en un solo lugar.</p></div><div class="ptc-tabs"><button class="active" type="button" data-ptc-tab="invoice">Factura</button><button type="button" data-ptc-tab="command">Comanda</button><button type="button" data-ptc-tab="close">Cierre de turno</button></div></div><div id="ptcBody"></div>';
  const edge=$('#edgeRepairPanel');if(edge)edge.insertAdjacentElement('afterend',section);else devices.prepend(section);
  $$('.ptc-tabs [data-ptc-tab]',section).forEach(b=>b.onclick=()=>{T.tab=b.dataset.ptcTab;renderTemplateTab()});
  try{const result=await Promise.all([api('/api/v1/restaurante/plantillas-documentos'),api('/api/v1/impresion/empresa')]);T.data=result[0];T.company=result[1];renderTemplateTab()}catch(e){$('#ptcBody').innerHTML='<div class="ptc-card" style="margin:14px">'+esc(e.message||'No fue posible cargar plantillas.')+'</div>'}
}
function startTemplateCenter(){mountTemplateCenter()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startTemplateCenter,{once:true});else startTemplateCenter();
})();
