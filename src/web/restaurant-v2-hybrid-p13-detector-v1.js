/* VANTIX_RESTAURANT_HYBRID_P13_DETECTOR_V1 */
(()=>{'use strict';
  const MARKER='VANTIX_RESTAURANT_HYBRID_P13_DETECTOR_V1';
  const P13_MARKER='VANTIX_RESTAURANT_FULL_LOCAL_P13_A';
  const P13_PORT='8790';
  const P13_STATUS_URL=`http://127.0.0.1:${P13_PORT}/__p13/status`;
  const SESSION_KEY='vantixgc_core_session_v1';
  const LOOPBACK=new Set(['127.0.0.1','localhost','::1','[::1]']);
  const PROBE_TIMEOUT_MS=1800;
  let running=false;
  let lastState=null;

  document.documentElement.dataset.restaurantHybridP13Detector=MARKER;

  function readSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
  function isLocalP13Surface(){return LOOPBACK.has(String(location.hostname||'').toLowerCase())&&String(location.port||'')===P13_PORT}
  function p13StatusUrl(){return isLocalP13Surface()?'/__p13/status':P13_STATUS_URL}
  function cloudSurface(){return !isLocalP13Surface()}
  function safeText(value){return String(value??'').replace(/[\r\n\t]+/g,' ').trim()}

  async function fetchJson(url,options={},timeoutMs=PROBE_TIMEOUT_MS){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{cache:'no-store',credentials:'omit',...options,signal:controller.signal});
      let body={};try{body=await response.json()}catch{}
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      return body;
    }finally{clearTimeout(timeout)}
  }

  async function probeP13(session){
    if(!session?.subdomain)return {available:false,reason:'Sesión del tenant no disponible'};
    try{
      const body=await fetchJson(p13StatusUrl(),{headers:{Accept:'application/json'}});
      const valid=body?.ok===true&&body?.marker===P13_MARKER&&String(body?.tenantSubdomain||'').toLowerCase()===String(session.subdomain||'').toLowerCase()&&Number(body?.port)===Number(P13_PORT)&&Number(body?.productionEdgePortUntouched)===8788;
      if(!valid)return {available:false,reason:'El servicio local respondió pero no coincide con este tenant o contrato P13'};
      return {available:true,data:body,reason:null};
    }catch(error){
      return {available:false,reason:error?.name==='AbortError'?'P13 no respondió a tiempo':'P13 no respondió'};
    }
  }

  function edgeRows(payload){return Array.isArray(payload)?payload:[]}
  function edgeOnline(row){
    if(row?.installation?.online===true||row?.online===true)return true;
    return String(row?.heartbeat||row?.agent?.heartbeat||'').toUpperCase()==='ONLINE';
  }
  function edgeVersion(row){return row?.installation?.softwareVersion||row?.agent?.softwareVersion||row?.agent?.version||row?.version||null}
  async function probeEdge(session){
    if(isLocalP13Surface())return {available:false,rows:[],online:null,reason:'No se consulta Edge cloud desde la superficie local P13'};
    if(!session?.token||!session?.subdomain)return {available:false,rows:[],online:null,reason:'Sesión cloud no disponible'};
    try{
      const body=await fetchJson('/api/v1/edge/installations',{headers:{Accept:'application/json',Authorization:`Bearer ${session.token}`,'x-tenant-subdomain':session.subdomain}},3500);
      const rows=edgeRows(body?.data);
      return {available:true,rows,online:rows.find(edgeOnline)||null,reason:null};
    }catch(error){return {available:false,rows:[],online:null,reason:error?.name==='AbortError'?'Telemetría Edge no respondió a tiempo':'Telemetría Edge no disponible'}}
  }

  function shellState(p13,edge){
    if(p13.available){
      return {kind:'online',label:'LOCAL P13 DISPONIBLE',detail:isLocalP13Surface()?'Motor local 8790 activo · esta pantalla opera localmente':'NUBE EN LÍNEA · motor local 8790 listo · sin cambio automático todavía'};
    }
    if(edge.online){
      const version=edgeVersion(edge.online);
      return {kind:'offline',label:'LOCAL P13 NO DISPONIBLE · Edge respaldo en línea',detail:`NUBE EN LÍNEA · continuidad Edge heredada disponible${version?` · Edge ${version}`:''}`};
    }
    if(cloudSurface())return {kind:'cloud',label:'LOCAL NO DISPONIBLE',detail:'NUBE EN LÍNEA · la operación continúa por Internet'};
    return {kind:'unknown',label:'LOCAL NO DISPONIBLE',detail:'La superficie local no confirmó el contrato P13'};
  }

  function renderShell(p13,edge){
    const button=document.querySelector('#p11HybridStatus');
    const label=document.querySelector('#p11HybridLabel');
    const detail=document.querySelector('#p11HybridDetail');
    if(!button||!label||!detail)return;
    const state=shellState(p13,edge);
    button.classList.remove('is-checking','is-online','is-offline','is-cloud','is-unknown');
    button.classList.add(`is-${state.kind}`);
    button.dataset.p13Detector=MARKER;
    label.textContent=state.label;
    detail.textContent=state.detail;
  }

  function setAdminCloud(){
    const status=document.querySelector('#hybridCloudStatus');
    const detail=document.querySelector('#hybridCloudDetail');
    if(!status||!detail)return;
    if(cloudSurface()){
      status.textContent='En línea';
      detail.textContent='Core disponible · esta pantalla opera por Internet.';
    }else{
      status.textContent='No verificada';
      detail.textContent='Esta pantalla está servida por P13 local; la nube no se usa para esta comprobación.';
    }
  }
  function setAdminP13(p13){
    const status=document.querySelector('#hybridP13Status');
    const detail=document.querySelector('#hybridP13Detail');
    if(!status||!detail)return;
    if(p13.available){
      status.textContent='Disponible';
      detail.textContent=`Motor local 127.0.0.1:${P13_PORT} listo · tenant ${safeText(p13.data?.tenantSubdomain||'')}.`;
    }else{
      status.textContent='No disponible';
      detail.textContent='No se confirmó un runtime P13 válido para este tenant.';
    }
  }
  function setAdminEdge(edge){
    const status=document.querySelector('#hybridEdgeStatus');
    const detail=document.querySelector('#hybridEdgeDetail');
    if(!status||!detail)return;
    if(isLocalP13Surface()){
      status.textContent='No consultado';
      detail.textContent='Edge queda como respaldo heredado y no se consulta desde la superficie local P13.';
      return;
    }
    if(edge.online){
      status.textContent='En línea';
      detail.textContent='Respaldo heredado Edge disponible mientras P13 se valida.';
    }else if(edge.available&&edge.rows.length){
      status.textContent='Sin conexión';
      detail.textContent='Hay Edge registrado, pero no está reportando heartbeat.';
    }else if(edge.available){
      status.textContent='No instalado';
      detail.textContent='No hay una instalación Edge registrada para este tenant.';
    }else{
      status.textContent='No disponible';
      detail.textContent='No se pudo consultar la telemetría Edge en este momento.';
    }
  }
  function renderAdmin(p13,edge){
    const panel=document.querySelector('#estado-local-nube');
    if(!panel)return;
    setAdminCloud();setAdminP13(p13);setAdminEdge(edge);
    const badge=document.querySelector('#hybridStateBadge');
    const meta=document.querySelector('#hybridStateMeta');
    if(badge){
      badge.className='hybrid-state-badge';
      if(p13.available){badge.classList.add('online');badge.textContent='LOCAL P13 DISPONIBLE'}
      else if(edge.online){badge.classList.add('offline');badge.textContent='LOCAL P13 NO DISPONIBLE'}
      else{badge.classList.add('cloud');badge.textContent='LOCAL NO DISPONIBLE'}
      badge.dataset.p13Detector=MARKER;
    }
    if(meta){
      if(p13.available)meta.textContent=`P13 validado · ${safeText(p13.data?.mutationMode||'motor local')} · puerto 8790 · Edge 8788 intacto.`;
      else if(edge.online)meta.textContent='P13 no confirmado · Edge permanece disponible únicamente como respaldo heredado.';
      else meta.textContent='P13 no confirmado · no hay continuidad local validada; la operación permanece por nube.';
    }
  }

  async function refresh(){
    if(running)return lastState;
    running=true;
    const session=readSession();
    try{
      const [p13,edge]=await Promise.all([probeP13(session),probeEdge(session)]);
      lastState={marker:MARKER,p13,edge,cloudSurface:cloudSurface(),automaticFailover:false,checkedAt:new Date().toISOString()};
      window.VantixGCRestaurantHybridP13DetectorV1=Object.freeze({...lastState,refresh});
      renderShell(p13,edge);renderAdmin(p13,edge);
      return lastState;
    }finally{running=false}
  }

  function scheduleRefresh(delay=0){setTimeout(()=>refresh().catch(()=>{}),delay)}
  function bind(){
    window.addEventListener('focus',()=>scheduleRefresh(120));
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')scheduleRefresh(120)});
    document.querySelector('#p11Frame')?.addEventListener('load',()=>scheduleRefresh(180));
    document.querySelector('#refresh')?.addEventListener('click',()=>{scheduleRefresh(180);scheduleRefresh(1400)});
    document.querySelector('#refreshDevices')?.addEventListener('click',()=>{scheduleRefresh(180);scheduleRefresh(1400)});
    scheduleRefresh(0);scheduleRefresh(1200);
    setInterval(()=>scheduleRefresh(0),15000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
