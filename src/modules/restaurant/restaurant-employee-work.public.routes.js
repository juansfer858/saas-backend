'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const work = require('./restaurant-employee-work.service');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const restaurantUiPath = path.join(webRoot, 'restaurant-ui.js');
const runtimePath = path.join(webRoot, 'restaurant-employee-work-runtime.js');
const WAITER_STABILITY_MARKER = 'VANTIX_WAITER_RENDER_SERIAL_V6';

function waiterStableBase(source) {
  let base = String(source || '');
  if (base.includes(WAITER_STABILITY_MARKER)) return base;

  const stateAnchor = "  const $ = (q) => document.querySelector(q);";
  if (!base.includes(stateAnchor)) throw new Error('WAITer V6: no se encontró ancla de estado');
  base = base.replace(stateAnchor, `  // ${WAITER_STABILITY_MARKER}\n  let waiterRenderPromise = null;\n  let waiterRenderQueued = false;\n  ${stateAnchor.trim()}`);

  const startAnchor = "  async function renderWaiter() {\n    await Promise.all([loadZones(), loadTables(), loadMenu()]);";
  if (!base.includes(startAnchor)) throw new Error('WAITer V6: no se encontró inicio de renderWaiter');
  base = base.replace(startAnchor, `  async function renderWaiter() {\n    if (waiterRenderPromise) {\n      waiterRenderQueued = true;\n      return waiterRenderPromise;\n    }\n    document.documentElement.dataset.waiterRenderBusy = '1';\n    waiterRenderPromise = (async () => {\n      await Promise.all([loadZones(), loadTables(), loadMenu()]);`);

  const endAnchor = "    S.poll=setInterval(()=>{if(S.tab==='mesero')refreshWaiterHistory(sessionId,tableId).catch(()=>{});},Math.max(Number(S.context.polling.floorMs||3000),2500));\n  }\n\n  function bindWaiterTop() {";
  if (!base.includes(endAnchor)) throw new Error('WAITer V6: no se encontró cierre de renderWaiter');
  base = base.replace(endAnchor, `    S.poll=setInterval(()=>{if(S.tab==='mesero')refreshWaiterHistory(sessionId,tableId).catch(()=>{});},Math.max(Number(S.context.polling.floorMs||3000),2500));\n    })();\n    try {\n      return await waiterRenderPromise;\n    } finally {\n      waiterRenderPromise = null;\n      delete document.documentElement.dataset.waiterRenderBusy;\n      if (waiterRenderQueued) {\n        waiterRenderQueued = false;\n        queueMicrotask(() => renderWaiter().catch((error) => message(error.message, true)));\n      }\n    }\n  }\n\n  function bindWaiterTop() {`);

  return base;
}

// Se monta antes del public router histórico para ampliar el motor probado sin
// duplicar restaurant-ui.js ni cambiar las rutas usadas por la PWA del mesero.
router.get('/app/restaurant-ui.js', async (_req, res, next) => {
  try {
    const [base, runtime] = await Promise.all([
      fs.promises.readFile(restaurantUiPath, 'utf8'),
      fs.promises.readFile(runtimePath, 'utf8')
    ]);
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript').send(`${waiterStableBase(base)}\n;${runtime}`);
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/employee-work-readiness', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok:true,
    data:{
      marker:work.MARKER,
      mode:'FLEXIBLE',
      flexibleSupport:true,
      waiterScope:['ZONAS','MESAS'],
      productionScope:['COCINA','BARRA','POSTRES'],
      assignmentIsAuthorization:false,
      waiterRenderStability:WAITER_STABILITY_MARKER
    }
  });
});

module.exports = { restaurantEmployeeWorkPublicRouter:router, waiterStableBase, WAITER_STABILITY_MARKER };
