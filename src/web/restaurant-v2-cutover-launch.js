/* VANTIX_RESTAURANT_V2_CUTOVER_LAUNCH_P10 */
(()=>{'use strict';
  const target=String(document.body?.dataset?.cutoverTarget||'').toLowerCase();
  const isProduction=target==='production';
  const sessionKey=isProduction?'vantixgc_restaurant_production_device_v63':'vantixgc_core_session_v1';
  const v2=isProduction?'/app/produccion-v2/':'/app/centro-de-control/mesero-v2/';
  const v1=isProduction?'/app/produccion-v1':'/app/centro-de-control/mesero-v1';
  function readJson(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
  function go(url){if(location.pathname!==url)location.replace(url)}
  const session=readJson(sessionKey);
  if(!session?.token||!session?.subdomain){go(v1);return}
  const cacheKey=`vantixgc_restaurant_v2_cutover_p10:${session.subdomain}`;
  const cached=readJson(cacheKey);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),4500);
  fetch('/api/v1/restaurante/v2/cutover/launch',{
    cache:'no-store',
    signal:controller.signal,
    headers:{Authorization:`Bearer ${session.token}`,'x-tenant-subdomain':session.subdomain}
  }).then(async(response)=>{
    let body={};try{body=await response.json()}catch{}
    if(!response.ok)throw new Error(body?.error?.message||`HTTP ${response.status}`);
    const enabled=Boolean(body?.data?.enabled);
    localStorage.setItem(cacheKey,JSON.stringify({enabled,at:new Date().toISOString(),marker:body?.data?.marker||null}));
    go(enabled?v2:v1);
  }).catch(()=>{
    // A previously confirmed cutover remains usable during a transient network
    // failure. With no prior decision, fail safe to V1 rather than force V2.
    go(cached?.enabled===true?v2:v1);
  }).finally(()=>clearTimeout(timeout));
})();
