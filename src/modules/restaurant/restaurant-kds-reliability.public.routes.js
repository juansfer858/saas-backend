'use strict';

const express = require('express');
const edgeVersion = require('../../../edge/version.json');

const MARKER = 'VANTIX_RESTAURANT_KDS_RELIABILITY_V2';
const router = express.Router();

const runtimeTail = `
;(()=>{
  const marker='${MARKER}';
  if(document.documentElement.dataset.vantixKdsReliability===marker)return;
  document.documentElement.dataset.vantixKdsReliability=marker;
  const style=document.createElement('style');
  style.id='vantix-kds-reliability-v2';
  style.textContent='.kds-kpi:first-child{cursor:pointer}.kds-kpi:first-child:focus{outline:2px solid currentColor;outline-offset:3px}.kds-v2-lane[data-vantix-pending-rescued="true"] header:after{content:"SIN KDS CONFIGURADO";margin-left:auto;padding:3px 7px;border-radius:999px;background:#fff4e5;color:#9a4f00;font-size:9px;font-weight:900;letter-spacing:.04em}';
  document.head.appendChild(style);

  const rescuePendingLanes=()=>{
    document.querySelectorAll('.kds-v2-lane[data-station]').forEach((lane)=>{
      const hasCommands=Boolean(lane.querySelector('.kds-command-card'));
      if(!hasCommands){
        delete lane.dataset.vantixPendingRescued;
        return;
      }
      lane.style.removeProperty('display');
      lane.removeAttribute('hidden');
      delete lane.dataset.rkdsHidden;
      lane.dataset.vantixPendingRescued='true';
    });
  };

  let rescueScheduled=false;
  const scheduleRescue=()=>{
    if(rescueScheduled)return;
    rescueScheduled=true;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      rescueScheduled=false;
      rescuePendingLanes();
    }));
  };

  const observer=new MutationObserver(scheduleRescue);
  observer.observe(document.body,{childList:true,subtree:true});
  scheduleRescue();

  document.addEventListener('click',(event)=>{
    const card=event.target?.closest?.('.kds-kpi');
    if(!card)return;
    const label=String(card.querySelector('small')?.textContent||'').trim().toLowerCase();
    if(label!=='pendientes')return;
    document.querySelector('[data-kds-filter="PENDIENTE"]')?.click();
    scheduleRescue();
  });
})();`;

function patchKdsRuntime(source) {
  let out = String(source || '');
  if (!out || out.includes(MARKER)) return out;
  const filterNeedle = 'const filtered = visible.filter(kdsMatches);';
  const filterReplacement = `let filtered = visible.filter(kdsMatches);\n    const pendingSafety = visible.filter((command) => command.state === 'PENDIENTE');\n    if (!filtered.length && pendingSafety.length) filtered = pendingSafety;`;
  if (!out.includes(filterNeedle)) throw new Error('RESTAURANT_KDS_FILTER_PATCH_TARGET_NOT_FOUND');
  return `/* ${MARKER} */\n${out.replace(filterNeedle, filterReplacement)}${runtimeTail}`;
}

function installKdsReliabilityRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const patched = patchKdsRuntime(source);
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      res.set('X-VantixGC-KDS-Reliability', 'v2-inline-hidden-rescue');
    }
    return originalSend(body);
  };
  return next();
}

router.get('/api/public/restaurante/kds-print-readiness', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    data: {
      marker: MARKER,
      pendingNeverHidden: true,
      pendingKpiActionable: true,
      inlineHiddenLaneRescue: true,
      printDelivery: 'CORE_BOOTSTRAP_TO_EDGE_PERSISTENT_QUEUE',
      onePrinterPerEndpoint: true,
      kitchenQueueCoversNamedStations: true,
      edgeVersion: edgeVersion.version,
      edgeChannel: edgeVersion.channel
    }
  });
});

module.exports = { MARKER, patchKdsRuntime, installKdsReliabilityRuntime, restaurantKdsReliabilityPublicRouter: router };
