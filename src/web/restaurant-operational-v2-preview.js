(()=>{'use strict';
  const MARKER='VANTIX_RESTAURANT_OPERATIONAL_UI_V2_P1';
  const RV2=window.RestaurantV2;
  if(!RV2||RV2.marker!=='VANTIX_RESTAURANT_V2_SDK_V1')throw new Error('Restaurant V2 SDK no disponible');
  const session=RV2.requireSession();
  window[MARKER]=Object.freeze({version:'1.1.0',readOnly:true,legacyUiPatched:false,designSystem:'VANTIX_RESTAURANT_V2_DESIGN_SYSTEM_V1',sdk:RV2.marker});
  const S={context:null,zones:[],tables:[],tab:'mesas'};
  const $=q=>document.querySelector(q);
  function status(text,error=false){const n=$('#status');n.textContent=text;n.classList.toggle('error',error)}
  function accountRequested(table){return Boolean(table?.activeSession&&(String(table.state||'')==='CUENTA_PEDIDA'||table.activeSession.accountRequestedAt))}
  function tableState(table){if(!table?.activeSession)return'LIBRE';return accountRequested(table)?'CUENTA SOLICITADA':'OCUPADA'}
  function tableClass(table){if(!table?.activeSession)return'rv2-table rv2-table-free';return accountRequested(table)?'rv2-table rv2-table-account-requested':'rv2-table rv2-table-occupied'}
  function renderMesas(){
    const occupied=S.tables.filter(table=>table.activeSession).length;
    const requested=S.tables.filter(accountRequested).length;
    const free=S.tables.length-occupied;
    $('#view').innerHTML=`<div class="metrics"><div class="metric"><small>Mesas</small><strong>${S.tables.length}</strong></div><div class="metric"><small>Libres</small><strong>${free}</strong></div><div class="metric"><small>Ocupadas</small><strong>${occupied}</strong></div><div class="metric"><small>Cuenta pedida</small><strong>${requested}</strong></div></div><section class="rv2-panel panel"><h2>Mesas · foundation V2</h2><p>Lectura directa del Core. La misma semántica visual será usada en PC, tablet y celular.</p><div class="table-grid">${S.tables.map(table=>`<article class="table-card ${tableClass(table)}"><header><h3>${RV2.esc(table.name||table.code||'Mesa')}</h3><span class="state">${RV2.esc(tableState(table))}</span></header><dl><dt>Zona</dt><dd>${RV2.esc(S.zones.find(zone=>zone.id===table.zoneId)?.name||'—')}</dd><dt>Personas</dt><dd>${Number(table.activeSession?.guestCount||0)}</dd><dt>Cuenta solicitada</dt><dd>${accountRequested(table)?'Sí':'No'}</dd></dl></article>`).join('')||'<div class="placeholder">No hay mesas configuradas.</div>'}</div></section>`;
  }
  function render(){
    document.querySelectorAll('[data-tab]').forEach(button=>{const active=button.dataset.tab===S.tab;button.classList.toggle('active',active);button.classList.toggle('rv2-btn-primary',active)});
    if(S.tab==='mesas')return renderMesas();
    $('#view').innerHTML=`<div class="placeholder"><strong>${S.tab==='pedidos'?'Pedidos V2':'Caja V2'}</strong><br>Este módulo tendrá bundle y ruta propios. No dependerá del DOM de Mesas.</div>`;
  }
  async function start(){
    try{
      status('Cargando contexto del restaurante…');
      [S.context,S.zones,S.tables]=await Promise.all([RV2.api('/api/v1/restaurante/ui-context'),RV2.api('/api/v1/restaurante/zonas'),RV2.api('/api/v1/restaurante/mesas')]);
      $('#restaurantName').textContent=S.context?.theme?.restaurantName||session.tenant?.nombreEmpresa||'Restaurante';
      $('#tenantLine').textContent=`${session.subdomain} · ${S.context?.user?.nombre||'Usuario'} · ${S.context?.user?.rol||''}`;
      status('Foundation V2 aislado · sólo lectura · QR y Super Core protegidos');
      render();
    }catch(error){status(error.message||'No fue posible cargar V2',true);$('#view').innerHTML='<div class="placeholder">La versión operativa actual continúa disponible sin cambios.</div>'}
  }
  document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{S.tab=button.dataset.tab;render()}));
  start();
})();
