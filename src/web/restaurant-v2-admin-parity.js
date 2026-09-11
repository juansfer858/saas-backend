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
