'use strict';

const HYBRID_LOCAL_ORIGIN_V53 = 'VANTIX_RESTAURANT_HYBRID_LOCAL_ORIGIN_V53';

const hybridLocalOriginRuntimeV53 = `(()=>{
  const MARKER='${HYBRID_LOCAL_ORIGIN_V53}';
  if(window.__vantixHybridLocalOriginV53===MARKER)return;
  window.__vantixHybridLocalOriginV53=MARKER;
  const params=new URLSearchParams(location.search);
  const requestedEdge=params.get('edge');
  const requestedReturn=params.get('return');
  if(!requestedEdge||!requestedReturn)return;
  let returnOrigin='';
  try{
    const parsed=new URL(requestedReturn);
    const host=String(parsed.hostname||'').toLowerCase();
    const loopback=host==='127.0.0.1'||host==='localhost'||host==='::1';
    const privateV4=/^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/.test(host);
    if(parsed.protocol!=='http:'||(!loopback&&!privateV4))return;
    returnOrigin=parsed.origin;
  }catch{return;}
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
    let target;
    try{target=new URL(typeof input==='string'||input instanceof URL?input:input?.url||'',location.origin);}catch{return nativeFetch(input,init);}
    const match=target.origin===location.origin&&target.pathname.match(/^\\/api\\/v1\\/edge\\/agents\\/([^/]+)\\/local-access-grant$/);
    if(!match||decodeURIComponent(match[1])!==requestedEdge||String(init.method||'GET').toUpperCase()!=='POST')return nativeFetch(input,init);
    let body={};
    try{body=init.body?JSON.parse(init.body):{};}catch{}
    return nativeFetch(input,{...init,headers:{'Content-Type':'application/json',...(init.headers||{})},body:JSON.stringify({...body,returnOrigin})});
  };
  window.VantixGCRestaurantHybridLocalOriginV53=Object.freeze({marker:MARKER,edge:requestedEdge,returnOrigin});
})();`;

function installRestaurantHybridLocalOriginV53(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(HYBRID_LOCAL_ORIGIN_V53)) {
      const patched = `${source}\n;${hybridLocalOriginRuntimeV53}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Restaurant-Hybrid-Origin', 'v53-safe-return');
    return originalSend(body);
  };
  return next();
}

module.exports = {
  HYBRID_LOCAL_ORIGIN_V53,
  hybridLocalOriginRuntimeV53,
  installRestaurantHybridLocalOriginV53
};
