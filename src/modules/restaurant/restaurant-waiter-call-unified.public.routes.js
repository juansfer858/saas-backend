'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { verifyAccessToken } = require('../../utils/jwt');
const calls = require('./restaurant-waiter-call.service');
const accountRequests = require('./restaurant-account-request.service');
const waiterDevices = require('./restaurant-waiter-device.service');
const broadcastCalls = require('./restaurant-waiter-call-broadcast.service');
const unified = require('./restaurant-waiter-call-unified.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const PC_MARKER = 'VANTIX_WAITER_CALL_PC_V31';

function bearer(req) {
  const header = String(req.get('authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function verifyStaffRequest(req) {
  const raw = bearer(req);
  if (!raw) throw new AppError(401, 'Autenticación requerida', 'RESTAURANT_WAITER_CALL_AUTH_REQUIRED');
  let payload;
  try { payload = verifyAccessToken(raw); }
  catch { throw new AppError(401, 'Sesión no válida', 'RESTAURANT_WAITER_CALL_AUTH_INVALID'); }
  if (!payload?.userId || !payload?.tenantId) throw new AppError(401, 'Sesión no válida', 'RESTAURANT_WAITER_CALL_AUTH_INVALID');
  const subdomain = String(req.get('x-tenant-subdomain') || '').trim().toLowerCase();
  if (!subdomain) throw new AppError(400, 'Falta el restaurante', 'TENANT_SUBDOMAIN_REQUIRED');
  const [tenant, user] = await Promise.all([
    prisma.tenant.findFirst({ where:{ id:payload.tenantId, subdomain, activo:true }, select:{ id:true } }),
    prisma.user.findFirst({ where:{ id:payload.userId, tenantId:payload.tenantId, activo:true }, select:{ id:true, nombre:true, rol:true } })
  ]);
  if (!tenant) throw new AppError(403, 'La sesión no pertenece a este restaurante', 'AUTH_TENANT_MISMATCH');
  const role = String(user?.rol || '').toUpperCase();
  if (!user || !broadcastCalls.STAFF_ROLES.has(role)) throw new AppError(403, 'Esta pantalla no puede recibir llamados de mesa', 'RESTAURANT_WAITER_CALL_STAFF_FORBIDDEN');
  if (payload.authType === 'WAITER_DEVICE') {
    if (role !== 'MESERO' || !payload.deviceId) throw new AppError(401, 'El dispositivo Mesero ya no es válido', 'RESTAURANT_WAITER_CALL_DEVICE_REQUIRED');
    await waiterDevices.assertActiveDevice(payload.deviceId, payload.tenantId, payload.userId);
  }
  return { tenantId:payload.tenantId, userId:payload.userId, role, authType:payload.authType || 'USER', deviceId:payload.deviceId || null };
}

router.post('/api/public/restaurante/qr/:token/llamar-mesero', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const data = await calls.createCall(req.params.token, String(req.get('x-vantix-restaurant-visit') || '').trim());
    const table = await prisma.restaurantTable.findUnique({ where:{ qrToken:req.params.token }, select:{ tenantId:true } });
    if (table?.tenantId) unified.kick(table.tenantId);
    res.status(201).json({ ok:true, data });
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/mesero-dispositivo/llamadas', async (req, res, next) => {
  try {
    const actor = await verifyStaffRequest(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:await unified.waiterAlertSnapshot(actor.tenantId, actor.userId, actor.role) });
  } catch (error) { next(error); }
});

router.post('/api/public/restaurante/mesero-dispositivo/llamadas/:id/atender', async (req, res, next) => {
  try {
    const actor = await verifyStaffRequest(req);
    const data = await broadcastCalls.attendCall(actor.tenantId, actor.userId, req.params.id);
    unified.kick(actor.tenantId);
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data });
  } catch (error) { next(error); }
});

router.post('/api/public/restaurante/mesero-dispositivo/solicitudes-cuenta/:id/atender', async (req, res, next) => {
  try {
    const actor = await verifyStaffRequest(req);
    if (actor.role !== 'MESERO') throw new AppError(403, 'La preparación de cuenta corresponde a un mesero', 'RESTAURANT_ACCOUNT_REQUEST_WAITER_REQUIRED');
    const data = await accountRequests.attendRequest(actor.tenantId, actor.userId, req.params.id);
    unified.kick(actor.tenantId);
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data });
  } catch (error) { next(error); }
});

function pcTableBridgeRuntime() {
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-attend-call][data-table-id]');
    if (!button || document.querySelector('#wvApp')) return;
    const tableId = String(button.dataset.tableId || '');
    if (!tableId) return;
    const selector = `[data-waiter-table="${CSS.escape(tableId)}"]`;
    setTimeout(() => document.querySelector(selector)?.click(), 0);
  }, true);
}

function installWaiterCallPcRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(PC_MARKER)) {
      const callUi = fs.readFileSync(path.join(webRoot, 'restaurant-waiter-call-ui.js'), 'utf8');
      const patched = `${source}\n;window.${PC_MARKER}=true;\n;${callUi}\n;(${pcTableBridgeRuntime.toString()})();\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Waiter-Call-PC', 'v31-unified');
    return originalSend(body);
  };
  return next();
}

module.exports = { restaurantWaiterCallUnifiedPublicRouter:router, installWaiterCallPcRuntime, PC_MARKER, verifyStaffRequest };
