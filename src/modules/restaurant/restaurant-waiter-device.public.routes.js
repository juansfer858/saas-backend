'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const service = require('./restaurant-waiter-device.service');
require('./restaurant-waiter-service-flex-v9');

const router = express.Router();
const pairHtml = path.join(__dirname, '../../web/restaurant-waiter-pair.html');
const waiterPwaV7Html = path.join(__dirname, '../../web/restaurant-waiter-pwa-v7.html');
const adminScript = path.join(__dirname, '../../web/restaurant-waiter-device-admin.js');
const performanceV6Script = path.join(__dirname, '../../web/restaurant-waiter-performance-v6.js');
const waiterRuntimeV7Script = path.join(__dirname, '../../web/restaurant-waiter-runtime-v7.js');
const waiterSessionV8Script = path.join(__dirname, '../../web/restaurant-waiter-session-v8.js');
const manifestFile = path.join(__dirname, '../../web/restaurant-waiter-manifest.webmanifest');
const swFile = path.join(__dirname, '../../web/restaurant-waiter-sw.js');
const iconFile = path.join(__dirname, '../../web/restaurant-waiter-icon.svg');
const icon192File = path.join(__dirname, '../../web/restaurant-waiter-icon-192.png');
const icon512File = path.join(__dirname, '../../web/restaurant-waiter-icon-512.png');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de vinculación inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

function waiterRuntimeV11(runtime) {
  const controlsNeedle = '<button type="button" class="wv-btn" data-action="add-person">+ Persona</button></div>';
  const controlsReplacement = '<button type="button" class="wv-btn" data-action="remove-person" aria-label="Quitar última persona">− Persona</button><button type="button" class="wv-btn" data-action="add-person">+ Persona</button></div>';
  const actionNeedle = "if (action === 'add-person') return updateService({ guestCount:guestCount() + 1 }, `Persona ${guestCount() + 1} agregada.`);";
  const actionReplacement = "if (action === 'remove-person') { const current = guestCount(); if (current <= 1) return message('La mesa debe conservar al menos una persona.', true); const next = current - 1; if (S.seat > next) S.seat = next; return updateService({ guestCount:next }, `Persona ${current} eliminada. Si tenía productos, pasan a Persona ${next}.`); }\n    if (action === 'add-person') return updateService({ guestCount:guestCount() + 1 }, `Persona ${guestCount() + 1} agregada.`);";
  const refreshNeedle = `function scheduleDetailRefresh() {
    if (S.detailRefreshTimer) clearTimeout(S.detailRefreshTimer);
    S.detailRefreshTimer = setTimeout(() => {
      S.detailRefreshTimer = null;
      if (!S.qtyJobs.size) refreshSelectedDetails({ quiet:true }).catch(() => {});
    }, 180);
  }`;
  const refreshReplacement = `function scheduleDetailRefresh() {
    if (S.detailRefreshTimer) clearTimeout(S.detailRefreshTimer);
    S.detailRefreshTimer = setTimeout(() => {
      S.detailRefreshTimer = null;
      if (S.mutationCount || S.qtyJobs.size) {
        scheduleDetailRefresh();
        return;
      }
      refreshSelectedDetails({ quiet:true }).catch(() => {});
    }, 220);
  }`;
  const updateNeedle = `async function updateService(payload, successText) {
    const sessionId = selectedSessionId();
    if (!sessionId) return;
    try {
      await flushQtyJobs();
      await mutate(\`/api/v1/restaurante/sesiones/\${sessionId}/servicio\`, { method:'PATCH', body:JSON.stringify(payload) });
      message(successText);
      S.detailsFingerprint = null;
      await refreshSelectedDetails({ quiet:true, force:true });
    } catch (error) { message(error.message, true); }
  }`;
  const updateReplacement = `function applyServiceLocally(patch = {}) {
    const table = selectedTable();
    if (!table?.activeSession) return;
    const previousMode = billingMode();
    const nextMode = patch.billingMode || previousMode;
    const nextGuests = patch.guestCount !== undefined ? Math.max(1, Number(patch.guestCount)) : guestCount();
    table.activeSession.billingMode = nextMode;
    table.activeSession.guestCount = nextGuests;
    if (S.draft?.session) {
      S.draft.session.billingMode = nextMode;
      S.draft.session.guestCount = nextGuests;
    }
    if (S.draft?.service) {
      S.draft.service = { ...S.draft.service, ...patch, billingMode:nextMode, guestCount:nextGuests };
      const migrate = (item) => {
        if (!item) return;
        if (nextMode === 'CONJUNTA') item.seatNumber = null;
        else if (previousMode !== 'INDIVIDUAL' || item.seatNumber == null) item.seatNumber = 1;
        else if (Number(item.seatNumber || 1) > nextGuests) item.seatNumber = nextGuests;
      };
      for (const item of Array.isArray(S.draft.service.allItems) ? S.draft.service.allItems : []) migrate(item);
      for (const item of Array.isArray(S.draft?.order?.items) ? S.draft.order.items : []) migrate(item);
    }
    if (S.seat > nextGuests) S.seat = nextGuests;
    if (nextMode === 'CONJUNTA') S.seat = 1;
    S.detailsFingerprint = null;
    renderServiceBar();
    renderMenuGrid();
    renderOrder();
    renderTables(true);
  }

  async function updateService(payload, successText) {
    const sessionId = selectedSessionId();
    const table = selectedTable();
    if (!sessionId || !table?.activeSession) return;
    const previous = {
      billingMode: billingMode(),
      guestCount: guestCount(),
      seat: S.seat,
      draftService: S.draft?.service ? { ...S.draft.service } : null,
      activeBillingMode: table.activeSession.billingMode,
      activeGuestCount: table.activeSession.guestCount
    };
    const mutationEpoch = ++S.detailsEpoch;
    touch();
    beginMutation();
    applyServiceLocally(payload);
    try {
      await flushQtyJobs();
      if (S.detailRefreshTimer) { clearTimeout(S.detailRefreshTimer); S.detailRefreshTimer = null; }
      if (selectedSessionId() !== sessionId) return;
      const result = await api(\`/api/v1/restaurante/sesiones/\${sessionId}/servicio\`, { method:'PATCH', body:JSON.stringify(payload) });
      if (S.detailsEpoch !== mutationEpoch || selectedSessionId() !== sessionId) return;
      if (result?.session) {
        table.activeSession.billingMode = result.session.billingMode || table.activeSession.billingMode;
        table.activeSession.guestCount = Number(result.session.guestCount || table.activeSession.guestCount || 1);
      }
      if (result?.service) applyServiceLocally(result.service);
      message(successText);
      scheduleDetailRefresh();
    } catch (error) {
      if (S.detailsEpoch === mutationEpoch && selectedSessionId() === sessionId) {
        table.activeSession.billingMode = previous.activeBillingMode;
        table.activeSession.guestCount = previous.activeGuestCount;
        if (S.draft?.service && previous.draftService) S.draft.service = previous.draftService;
        S.seat = previous.seat;
        applyServiceLocally({ billingMode:previous.billingMode, guestCount:previous.guestCount });
      }
      message(error.message, true);
    } finally {
      endMutation();
    }
  }`;

  for (const needle of [controlsNeedle, actionNeedle, refreshNeedle, updateNeedle]) {
    if (!runtime.includes(needle)) throw new Error('No fue posible aplicar el contrato Mesero V11 sobre el runtime base');
  }
  return `/* VANTIX_WAITER_NO_REBOUND_V11 */\n${runtime}`
    .replace(controlsNeedle, controlsReplacement)
    .replace(actionNeedle, actionReplacement)
    .replace(refreshNeedle, refreshReplacement)
    .replace(updateNeedle, updateReplacement)
    .replace("version:'7.1.0'", "version:'11.0.0'")
    .replace("pollDomDiff:true", "pollDomDiff:true, removePerson:true, flexibleGuestMerge:true, noRebound:true, singleStateOwner:true");
}

function waiterPwaV11(html) {
  return html.replace('restaurant-waiter-runtime-v7.js?v=waiter-runtime-v8', 'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v11');
}

const claimSchema = z.object({ token: z.string().trim().min(20).max(300), deviceName: z.string().trim().max(80).optional().nullable() });

router.get('/api/public/restaurante/mesero-dispositivo/vinculo', async (req, res, next) => {
  try { const token = String(req.query.t || '').trim(); if (!token) throw new AppError(400, 'Falta el código de vinculación', 'RESTAURANT_WAITER_PAIRING_TOKEN_REQUIRED'); res.json({ ok: true, data: await service.inspectPairing(token) }); } catch (error) { next(error); }
});
router.post('/api/public/restaurante/mesero-dispositivo/vincular', async (req, res, next) => {
  try { const input = parse(claimSchema, req.body || {}); const data = await service.claimPairing(input.token, { deviceName: input.deviceName, userAgent: req.get('user-agent') || '' }); res.status(201).json({ ok: true, data }); } catch (error) { next(error); }
});
router.get('/app/restaurant-waiter-device-admin.js', (_req, res) => { res.set('Cache-Control', 'no-store'); res.type('application/javascript').sendFile(adminScript); });
router.get('/app/restaurant-waiter-performance-v6.js', (_req, res) => { res.set('Cache-Control', 'no-store'); res.type('application/javascript').sendFile(performanceV6Script); });
router.get('/app/restaurant-waiter-runtime-v7.js', async (_req, res, next) => {
  try {
    const [sessionBridge, runtime] = await Promise.all([
      fs.promises.readFile(waiterSessionV8Script, 'utf8'),
      fs.promises.readFile(waiterRuntimeV7Script, 'utf8')
    ]);
    const patchedRuntime = waiterRuntimeV11(runtime);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-Runtime', 'v11-no-rebound');
    res.type('application/javascript').send(`${sessionBridge}\n;${patchedRuntime}`);
  } catch (error) { next(error); }
});
router.get('/app/centro-de-control/conectar', (_req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(pairHtml); });
router.get('/app/centro-de-control/mesero', async (_req, res, next) => {
  try {
    const html = waiterPwaV11(await fs.promises.readFile(waiterPwaV7Html, 'utf8'));
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-PWA', 'v11-no-rebound-persistent');
    res.type('text/html').send(html);
  } catch (error) { next(error); }
});
router.get('/app/centro-de-control/manifest.webmanifest', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.type('application/manifest+json').sendFile(manifestFile); });
router.get('/app/centro-de-control/sw.js', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.set('Service-Worker-Allowed', '/app/centro-de-control'); res.type('application/javascript').sendFile(swFile); });
router.get('/app/centro-de-control/waiter-icon.svg', (_req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.type('image/svg+xml').sendFile(iconFile); });
router.get('/app/centro-de-control/waiter-icon-192.png', (_req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.type('image/png').sendFile(icon192File); });
router.get('/app/centro-de-control/waiter-icon-512.png', (_req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.type('image/png').sendFile(icon512File); });

module.exports = { restaurantWaiterDevicePublicRouter: router, waiterRuntimeV11, waiterPwaV11 };
