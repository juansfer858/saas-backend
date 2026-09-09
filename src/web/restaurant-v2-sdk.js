/* VANTIX_RESTAURANT_V2_SDK_V1 */
(()=>{'use strict';
  const SESSION_KEY='vantixgc_core_session_v1';
  const EVENT_PREFIX='vantix:restaurant-v2:';
  const CONTROL_PATH='/app/centro-de-control';
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
  function cameFromControlCenter(){return new URLSearchParams(location.search).get('from')==='control-center'}
  function goControlCenter(){location.assign(CONTROL_PATH)}
  function mountControlCenterReturn(){
    if(!cameFromControlCenter()||document.querySelector('[data-v2-control-return]'))return;
    const button=document.createElement('button');
    button.type='button';
    button.dataset.v2ControlReturn='true';
    button.textContent='← Centro de control';
    button.setAttribute('aria-label','Volver al Centro de control del Restaurante');
    Object.assign(button.style,{position:'fixed',left:'12px',bottom:'12px',zIndex:'9999',minHeight:'44px',padding:'0 14px',border:'1px solid #cbd5e1',borderRadius:'12px',background:'#fff',color:'#17212b',font:'800 13px system-ui,sans-serif',boxShadow:'0 8px 24px rgba(15,23,42,.16)',cursor:'pointer'});
    button.addEventListener('click',goControlCenter);
    document.body.appendChild(button);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountControlCenterReturn,{once:true});else mountControlCenterReturn();
  window.RestaurantV2=Object.freeze({marker:'VANTIX_RESTAURANT_V2_SDK_V1',version:'1.1.0',readSession,requireSession,api,can,esc,money,emit,on,cameFromControlCenter,goControlCenter,mountControlCenterReturn});
})();
