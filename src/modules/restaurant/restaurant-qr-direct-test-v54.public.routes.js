'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const direct = require('./restaurant-qr-direct-test-v54.service');

const router = express.Router();
const MARKER = 'VANTIX_RESTAURANT_QR_DIRECT_TEST_V54';

const directAuthorizeSchema = z.object({
  seatNumber: z.coerce.number().int().min(1).max(50).optional().default(1)
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Autopedido directo inválido', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

router.post('/api/public/restaurante/qr/:token/autorizar-directo', async (req, res, next) => {
  try {
    const input = parse(directAuthorizeSchema, req.body || {});
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-QR-Direct-Test', 'v54-no-pin');
    res.json({ ok: true, data: await direct.authorizeDirectVisit(req.params.token, input.seatNumber) });
  } catch (error) { next(error); }
});

const qrDirectTestRuntimeV54 = String.raw`
;(()=>{
  'use strict';
  const MARKER='${MARKER}';
  if(window[MARKER]) return;
  const qrToken=decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()||'');
  if(!qrToken) return;
  const prefix='/api/public/restaurante/qr/'+encodeURIComponent(qrToken);
  const storageKey='vantixgc_restaurant_visit_'+qrToken;
  const previousFetch=window.fetch.bind(window);
  let authorizing=null;

  function target(input){return typeof input==='string'?input:(input&&typeof input.url==='string'?input.url:'');}
  function method(input,init){return String(init?.method||(typeof Request!=='undefined'&&input instanceof Request?input.method:'GET')).toUpperCase();}
  function isOrder(input,init){return method(input,init)==='POST'&&target(input).includes(prefix+'/pedidos');}
  function stored(){return String(localStorage.getItem(storageKey)||'').trim();}

  async function visit(){
    const response=await previousFetch(prefix+'/visita',{cache:'no-store'});
    const body=await response.clone().json().catch(()=>({}));
    if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
    return body?.data||{};
  }

  async function directAuthorize(){
    if(authorizing) return authorizing;
    authorizing=(async()=>{
      const state=await visit();
      if(!state?.open) return false;
      if(state.authorized&&stored()) return true;
      if(stored()) localStorage.removeItem(storageKey);
      const response=await previousFetch(prefix+'/autorizar-directo',{
        method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({seatNumber:Number(state.seatNumber||1)})
      });
      const body=await response.clone().json().catch(()=>({}));
      if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
      if(!body?.data?.visitToken) throw new Error('VantixGC no devolvió la autorización directa del teléfono');
      localStorage.setItem(storageKey,body.data.visitToken);
      document.documentElement.dataset.qrDirectTest='1';
      window.dispatchEvent(new CustomEvent('vantix:qr-direct-authorized',{detail:{seatNumber:body.data.seatNumber||1}}));
      return true;
    })().finally(()=>{authorizing=null;});
    return authorizing;
  }

  window.fetch=async(input,init={})=>{
    if(isOrder(input,init)) {
      try{await directAuthorize();}catch(error){
        return new Response(JSON.stringify({ok:false,error:{code:'RESTAURANT_QR_DIRECT_TEST_AUTH_FAILED',message:error.message||'No fue posible habilitar el pedido directo'}}),{status:409,headers:{'Content-Type':'application/json'}});
      }
    }
    return previousFetch(input,init);
  };

  document.documentElement.dataset.qrDirectTest='1';
  window[MARKER]=Object.freeze({version:'54.0.0',mode:'DIRECT_TEST',pinRequired:false,ordersDirect:true});
})();
`;

const operatorDirectTestRuntimeV54 = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_QR_DIRECT_TEST_OPERATOR_V54';
  if(window[MARKER]) return;
  const style=document.createElement('style');
  style.id='restaurantQrDirectTestV54Style';
  style.textContent='#waiterVisitCodeV32{display:none!important}';
  document.head.appendChild(style);
  document.documentElement.dataset.qrDirectTest='1';
  window[MARKER]=Object.freeze({version:'54.0.0',visitCodeVisible:false,directTest:true});
})();
`;

function installRestaurantQrDirectTestV54(req, res, next) {
  if (req.method !== 'GET' || !['/app/restaurant-qr-ui.js', '/app/restaurant-ui.js'].includes(req.path)) return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const runtime = req.path === '/app/restaurant-qr-ui.js' ? qrDirectTestRuntimeV54 : operatorDirectTestRuntimeV54;
      const patched = `${source}\n;${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-QR-Direct-Test', 'v54-no-pin');
    return originalSend(body);
  };
  return next();
}

module.exports = {
  MARKER,
  qrDirectTestRuntimeV54,
  operatorDirectTestRuntimeV54,
  restaurantQrDirectTestV54PublicRouter: router,
  installRestaurantQrDirectTestV54
};
