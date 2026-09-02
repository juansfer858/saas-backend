'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const router = express.Router();
const controlCenterPath = path.join(__dirname, '..', '..', 'web', 'restaurant-control-center.js');

const resiliencePrelude = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_CONTROL_CENTER_FETCH_TIMEOUT_V1';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({version:'1.0.0',timeoutMs:8000});
  const nativeFetch=window.fetch.bind(window);
  window.fetch=function(input,init={}){
    const url=typeof input==='string' ? input : String(input?.url || '');
    const isRestaurantApi=url.includes('/api/v1/restaurante/');
    if(!isRestaurantApi || init?.signal) return nativeFetch(input,init);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),8000);
    return nativeFetch(input,{...init,signal:controller.signal})
      .finally(()=>clearTimeout(timer));
  };
})();
`;

router.get('/app/restaurant-control-center.js', async (_req, res, next) => {
  try {
    const source = await fs.promises.readFile(controlCenterPath, 'utf8');
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Control-Center-Resilience', 'fetch-timeout-v1');
    res.type('application/javascript').send(`${resiliencePrelude}\n;${source}`);
  } catch (error) {
    next(error);
  }
});

module.exports = { restaurantControlCenterResiliencePublicRouter: router, resiliencePrelude };
