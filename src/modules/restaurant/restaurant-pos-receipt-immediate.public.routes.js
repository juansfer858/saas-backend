'use strict';

require('./restaurant-pos-receipt-hooks');

const MARKER = 'VANTIX_RESTAURANT_POS_RECEIPT_V38';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_POS_RECEIPT_V38';
  if(window[MARKER])return;
  window[MARKER]=true;
  const SESSION_KEY='vantixgc_core_session_v1';
  const baseFetch=window.fetch.bind(window);
  let triggerTimer=null;
  function session(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
  function headers(){const s=session();return s?.token&&s?.subdomain?{Authorization:'Bearer '+s.token,'x-tenant-subdomain':s.subdomain,Accept:'application/json'}:null}
  function isPaymentMutation(url,method){
    if(method!=='POST')return false;
    const path=url.pathname;
    if(/^\/api\/v1\/restaurante\/mesas\/[^/]+\/cerrar$/.test(path))return true;
    if(/^\/api\/v1\/restaurante\/mesas\/[^/]+\/cerrar-con-metodo$/.test(path))return true;
    if(/^\/api\/v1\/restaurante\/mesas\/[^/]+\/pagos-divididos$/.test(path))return true;
    return false;
  }
  async function signalReceiptSync(){
    triggerTimer=null;
    const h=headers();
    if(!h||navigator.onLine===false)return;
    try{
      const installationsResponse=await baseFetch('/api/v1/edge/installations',{cache:'no-store',headers:h});
      if(!installationsResponse.ok)return;
      const body=await installationsResponse.json().catch(()=>({}));
      const rows=Array.isArray(body?.data)?body.data:[];
      const edge=rows.find((row)=>row?.agent?.state==='ACTIVE'&&row?.installation?.online===true);
      if(!edge?.agent?.id)return;
      await baseFetch('/api/v1/edge/relay/requests',{
        method:'POST',cache:'no-store',headers:{...h,'Content-Type':'application/json'},
        body:JSON.stringify({edgeAgentId:edge.agent.id,action:'PRINT_QUEUE',requestBody:{operation:'POS_RECEIPT_SYNC'},ttlSeconds:30})
      }).catch(()=>{});
    }catch{}
  }
  function queueReceiptSync(){
    if(triggerTimer)clearTimeout(triggerTimer);
    triggerTimer=setTimeout(signalReceiptSync,40);
  }
  window.fetch=async function vantixPosReceiptFetch(input,options={}){
    const url=new URL(typeof input==='string'?input:(input?.url||''),location.origin);
    const method=String(options?.method||'GET').toUpperCase();
    const shouldTrigger=isPaymentMutation(url,method);
    const response=await baseFetch(input,options);
    if(shouldTrigger&&response.ok)queueReceiptSync();
    return response;
  };
  window.VantixGCRestaurantPosReceiptV38=Object.freeze({version:'38.0.0',automatic:true,edgeAction:'PRINT_QUEUE',operation:'POS_RECEIPT_SYNC'});
})();
`;

function installPosReceiptImmediateRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n;${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-POS-Receipt', 'v38-auto-after-payment');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installPosReceiptImmediateRuntime };
