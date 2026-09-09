/* VANTIX_RESTAURANT_V2_DEVICE_SDK_P8 · VANTIX_RESTAURANT_V2_DEVICE_PERSISTENCE_P10_FIX */
(()=>{'use strict';
  const CORE_SESSION_KEY='vantixgc_core_session_v1';
  const WAITER_BACKUP_SESSION_KEY='vantixgc_waiter_device_session_v26';
  const PRODUCTION_SESSION_KEY='vantixgc_restaurant_production_device_v63';
  const EVENT_PREFIX='vantix:restaurant-v2:';
  const device=String(document.body?.dataset?.vantixDevice||'').toLowerCase();
  const sessionKey=device==='production'?PRODUCTION_SESSION_KEY:CORE_SESSION_KEY;
  const validProductionRoles=new Set(['COCINA','BARRA','POSTRES']);
  const revokedCodes=new Set(device==='production'
    ?['RESTAURANT_PRODUCTION_DEVICE_REVOKED','RESTAURANT_PRODUCTION_DEVICE_ROLE_INVALID','RESTAURANT_PRODUCTION_DEVICE_ROLE_CHANGED']
    :['RESTAURANT_WAITER_DEVICE_REVOKED']);

  function readJson(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
  function roleOf(session){return String(session?.user?.rol||session?.station||'').toUpperCase()}
  function isValidSession(session){
    if(!session?.token||!session?.subdomain)return false;
    const role=roleOf(session);
    if(device==='production')return validProductionRoles.has(role);
    if(device==='waiter')return role==='MESERO';
    return false;
  }
  function readSession(){
    let current=readJson(sessionKey);
    if(device!=='waiter')return current;
    if(isValidSession(current)){
      try{localStorage.setItem(WAITER_BACKUP_SESSION_KEY,JSON.stringify(current))}catch{}
      return current;
    }
    const backup=readJson(WAITER_BACKUP_SESSION_KEY);
    if(isValidSession(backup)){
      try{localStorage.setItem(CORE_SESSION_KEY,JSON.stringify(backup))}catch{}
      current=backup;
    }
    return current;
  }
  function clearRevokedSession(){
    localStorage.removeItem(sessionKey);
    if(device==='waiter')localStorage.removeItem(WAITER_BACKUP_SESSION_KEY);
  }
  function deviceLabel(){return device==='production'?'Producción V2':'Mesero V2'}
  function showFatal(message){
    const text=String(message||`Este dispositivo no tiene una sesión válida de ${deviceLabel()}.`);
    document.documentElement.dataset.vantixDeviceSession='missing';
    if(!document.body)return;
    document.body.innerHTML=`<main style="min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f8fafc;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#172033"><section style="width:min(620px,100%);padding:28px;border:1px solid #dbe3ea;border-radius:20px;background:white;box-shadow:0 18px 50px rgba(15,23,42,.10);text-align:center"><small style="font-weight:900;letter-spacing:.10em;color:#137a53">VANTIXGC RESTAURANTES · P8</small><h1 style="margin:10px 0 8px;font-size:28px">${deviceLabel()}</h1><p style="margin:0;color:#64748b;line-height:1.55">${text.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}</p><p style="margin:18px 0 0;color:#475569;font-size:13px">Vincula nuevamente este dispositivo desde Administración sólo si su acceso fue retirado.</p></section></main>`;
  }
  function requireSession(){
    const session=readSession();
    if(!isValidSession(session)){
      showFatal(`No existe una vinculación activa para ${deviceLabel()}.`);
      throw new Error('DEVICE_SESSION_REQUIRED');
    }
    document.documentElement.dataset.vantixDeviceSession='active';
    return session;
  }
  async function api(path,opts={}){
    const session=requireSession();
    const url=String(path||'');
    if(!url.startsWith('/api/'))throw new Error('Restaurant V2 sólo permite rutas API internas');
    const response=await fetch(url,{...opts,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.token}`,'x-tenant-subdomain':session.subdomain,...(opts.headers||{})}});
    let body={};try{body=await response.json()}catch{}
    if(!response.ok){
      const code=String(body?.error?.code||body?.code||'');
      const revoked=revokedCodes.has(code);
      if(revoked){
        clearRevokedSession();
        window.dispatchEvent(new CustomEvent('vantix:restaurant-v2-device-revoked',{detail:{device,status:response.status,code}}));
      }
      const error=new Error(body?.error?.message||body?.message||(revoked?`La autorización de ${deviceLabel()} ya no es válida.`:`HTTP ${response.status}`));
      error.status=response.status;
      error.code=code||null;
      error.revoked=revoked;
      error.sessionPreserved=!revoked;
      throw error;
    }
    if(device==='waiter'){
      try{localStorage.setItem(WAITER_BACKUP_SESSION_KEY,JSON.stringify(session))}catch{}
    }
    return body.data;
  }
  function can(context,permission){const permissions=context?.permissions||[];return permissions.includes('*')||permissions.includes(permission)}
  function esc(value){return String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
  function money(value,currency=null){const session=readSession();return new Intl.NumberFormat('es-CO',{style:'currency',currency:currency||session?.tenant?.moneda||'COP',maximumFractionDigits:0}).format(Number(value||0))}
  function emit(name,detail){window.dispatchEvent(new CustomEvent(`${EVENT_PREFIX}${name}`,{detail}))}
  function on(name,handler){const eventName=`${EVENT_PREFIX}${name}`;window.addEventListener(eventName,handler);return()=>window.removeEventListener(eventName,handler)}

  window.RestaurantV2=Object.freeze({marker:'VANTIX_RESTAURANT_V2_DEVICE_SDK_P8',version:'8.1.0',device,sessionKey,waiterBackupSessionKey:WAITER_BACKUP_SESSION_KEY,readSession,requireSession,api,can,esc,money,emit,on,sessionPreservedOnForbidden:true,explicitRevocationOnly:true});
})();
