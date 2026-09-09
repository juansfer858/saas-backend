/* VANTIX_RESTAURANT_V2_CUTOVER_UI_P10 */
(()=>{'use strict';
  const V=window.RestaurantV2;
  if(!V)throw new Error('Restaurant V2 SDK no disponible');
  let state=null;
  const $=(q)=>document.querySelector(q);const esc=V.esc;
  function notice(text,type=''){const n=$('#notice');n.textContent=text||'';n.className=`cut-notice ${type}`.trim()}
  function routeCard(label,path,target){return `<div class="route-card"><small>${esc(label)}</small><b>${esc(path)}</b><span>→ ${esc(target)}</span></div>`}
  function rollbackRow(label,path){return `<div class="rollback-row"><b>${esc(label)}</b><a href="${esc(path)}" target="_blank" rel="noopener">${esc(path)}</a></div>`}
  async function load(){
    notice('Actualizando estado P10…');
    try{state=await V.api('/api/v1/restaurante/v2/cutover');render();notice('Estado de migración actualizado.','ok')}catch(error){notice(error.message,'error')}
  }
  function render(){
    if(!state)return;
    const session=V.requireSession();const cut=state.cutover||{};const ready=state.readiness||{};const p=state.pilot||{};
    $('#tenantLine').textContent=`${ready.tenant?.nombreEmpresa||session.tenant?.nombreEmpresa||'Restaurante'} · ${session.subdomain}`;
    $('#cutState').textContent=cut.enabled?'V2 PRINCIPAL':'V1 / PILOTO';
    $('#cutBadge').textContent=cut.enabled?'CUTOVER ACTIVO':'SIN CUTOVER';
    $('#cutBadge').classList.toggle('on',Boolean(cut.enabled));
    $('#cutMeta').textContent=cut.enabled?`Activo desde ${cut.activatedAt?new Date(cut.activatedAt).toLocaleString('es-CO'):'—'}. Las rutas V1 permanecen disponibles para rollback.`:'V2 sigue disponible, pero los entrypoints canónicos de dispositivos todavía conservan V1 como opción por defecto.';
    const required=Array.isArray(ready.required)?ready.required:[];const ok=required.filter(x=>x.ok).length;
    $('#requiredScore').textContent=`${ok}/${required.length}`;
    $('#requiredChecks').innerHTML=required.map(row=>`<div class="check-row ${row.ok?'ok':'bad'}"><span>${esc(row.label)}</span><b>${row.ok?'✓':'✕'} ${esc(row.value)}</b></div>`).join('');
    $('#pilotState').textContent=p.enabled?'ACTIVO':'APAGADO';
    $('#pilotMeta').textContent=p.enabled?'El piloto está activo y puede sostener un cutover P10.':'P10 no puede activarse hasta que el piloto V2 esté activo.';
    const blockers=Array.isArray(state.blockers)?state.blockers:[];
    $('#blockers').innerHTML=blockers.length?blockers.map(x=>`<div class="blocker"><span>Bloqueo</span><b>${esc(x)}</b></div>`).join(''):'<div class="check-row ok"><span>Bloqueos para el corte</span><b>✓ Ninguno</b></div>';
    const canonical=cut.canonical||{};const v2=cut.v2Targets||{};const rollback=cut.rollback||{};
    const enabled=Boolean(cut.enabled);
    $('#routes').innerHTML=[
      routeCard('Restaurante',canonical.restaurant||'/app/restaurante',enabled?(v2.controlCenter||'/app/centro-de-control'):(rollback.restaurant||'/app/restaurante-v1')),
      routeCard('Centro de control',canonical.controlCenter||'/app/centro-de-control',enabled?'V2 por rol':'Centro de control con piloto'),
      routeCard('Mesero',canonical.waiter||'/app/centro-de-control/mesero',enabled?(v2.waiter||'/app/centro-de-control/mesero-v2/'):(rollback.waiter||'/app/centro-de-control/mesero-v1')),
      routeCard('Producción',canonical.production||'/app/produccion',enabled?(v2.production||'/app/produccion-v2/'):(rollback.production||'/app/produccion-v1')),
      routeCard('QR cliente',canonical.clientQr||'/r/<qrToken>','P7 V2 · token físico sin cambios')
    ].join('');
    $('#rollback').innerHTML=[rollbackRow('Restaurante V1',rollback.restaurant||'/app/restaurante-v1'),rollbackRow('Mesero V1',rollback.waiter||'/app/centro-de-control/mesero-v1'),rollbackRow('Producción V1',rollback.production||'/app/produccion-v1')].join('');
    $('#enable').disabled=enabled||!state.canActivate;
    $('#disable').disabled=!enabled;
    if(document.activeElement!==$('#notes'))$('#notes').value=cut.notes||'';
  }
  async function change(enabled){
    if(enabled&&!confirm('¿Activar V2 como sistema principal para este tenant? V1 seguirá disponible como rollback.'))return;
    if(!enabled&&!confirm('¿Volver a V1 como entrada principal? No se borrará ninguna operación realizada en V2.'))return;
    const button=enabled?$('#enable'):$('#disable');button.disabled=true;notice(enabled?'Activando cutover P10…':'Regresando la entrada principal a V1…');
    try{state=await V.api('/api/v1/restaurante/v2/cutover',{method:'PATCH',body:JSON.stringify({enabled,notes:$('#notes').value.trim()||null})});
      // PATCH returns the canonical cutover payload; refresh once to include blockers/safety.
      await load();notice(enabled?'V2 quedó como sistema principal de este tenant.':'V1 volvió a ser la entrada principal; los datos V2 se conservaron.','ok');
    }catch(error){notice(error.message,'error');button.disabled=false}
  }
  $('#refresh')?.addEventListener('click',load);$('#enable')?.addEventListener('click',()=>change(true));$('#disable')?.addEventListener('click',()=>change(false));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();
})();
