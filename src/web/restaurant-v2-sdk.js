/* VANTIX_RESTAURANT_V2_SDK_V1 */
(()=>{'use strict';
  const SESSION_KEY='vantixgc_core_session_v1';
  const EVENT_PREFIX='vantix:restaurant-v2:';
  function readSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
  function requireSession(){const session=readSession();if(!session){location.assign('/app');throw new Error('Se requiere sesión de VantixGC')}return session}
  async function api(path,opts={}){
    const session=requireSession();
    const url=String(path||'');
    if(!url.startsWith('/api/'))throw new Error('Restaurant V2 sólo permite rutas API internas');
    const response=await fetch(url,{...opts,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.token}`,'x-tenant-subdomain':session.subdomain,...(opts.headers||{})}});
    let body={};try{body=await response.json()}catch{}
    if(response.status===401){localStorage.removeItem(SESSION_KEY);location.assign('/app');throw new Error('Sesión vencida')}
    if(!response.ok)throw new Error(body?.error?.message||`HTTP ${response.status}`);
    return body.data;
  }
  function can(context,permission){const permissions=context?.permissions||[];return permissions.includes('*')||permissions.includes(permission)}
  function esc(value){return String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
  function money(value,currency=null){const session=readSession();return new Intl.NumberFormat('es-CO',{style:'currency',currency:currency||session?.tenant?.moneda||'COP',maximumFractionDigits:0}).format(Number(value||0))}
  function emit(name,detail){window.dispatchEvent(new CustomEvent(`${EVENT_PREFIX}${name}`,{detail}))}
  function on(name,handler){const eventName=`${EVENT_PREFIX}${name}`;window.addEventListener(eventName,handler);return()=>window.removeEventListener(eventName,handler)}
  window.RestaurantV2=Object.freeze({marker:'VANTIX_RESTAURANT_V2_SDK_V1',version:'1.0.0',readSession,requireSession,api,can,esc,money,emit,on});
})();
