const crypto = require('node:crypto');
const express = require('express');
const service = require('./notifications.service');
const { AppError } = require('../../utils/app-error');

const router = express.Router();

function verifyMetaSignature(req) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new AppError(503, 'META_APP_SECRET requerido para verificar webhooks', 'META_WEBHOOK_SECRET_REQUIRED');
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const supplied = String(req.headers['x-hub-signature-256'] || '');
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new AppError(401, 'Firma de webhook Meta inválida', 'META_WEBHOOK_SIGNATURE_INVALID');
}

router.get('/webhooks/whatsapp', async (req, res, next) => {
  try {
    const challenge = await service.verifyWebhook(req.query['hub.mode'], req.query['hub.verify_token'], req.query['hub.challenge']);
    res.status(200).send(String(challenge));
  } catch (error) { next(error); }
});

router.post('/webhooks/whatsapp', async (req, res, next) => {
  try {
    verifyMetaSignature(req);
    await service.handleWhatsAppWebhook(req.body);
    res.status(200).json({ ok: true });
  } catch (error) { next(error); }
});

router.get('/api/public/seguimiento/:token', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getPublicTracking(req.params.token) }); }
  catch (error) { next(error); }
});

router.get('/seguimiento/:token', async (req, res, next) => {
  try {
    const data = await service.getPublicTracking(req.params.token);
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
    const timeline = (data.timeline || []).map((item) => `<li><strong>${esc(item.status)}</strong><span>${item.at ? new Date(item.at).toLocaleString('es-CO') : ''}</span>${item.note ? `<small>${esc(item.note)}</small>` : ''}</li>`).join('');
    res.status(data.expired ? 410 : 200).type('html').send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seguimiento · VantixGC</title>
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f4f4f5;color:#18221d}.wrap{max-width:680px;margin:0 auto;padding:24px}.card{background:#fff;border:1px solid #e4e4e7;border-radius:18px;padding:22px}.brand{font-weight:850;color:#0d6b43}.state{font-size:27px;font-weight:850;margin:10px 0 20px}.muted{color:#61706a}ul{list-style:none;padding:0;margin:18px 0 0}li{border-top:1px solid #eee;padding:13px 0;display:grid;grid-template-columns:1fr auto;gap:4px 12px}li small{grid-column:1/-1;color:#61706a}</style></head>
<body><div class="wrap"><div class="brand">VantixGC</div><h1>Seguimiento</h1><div class="card">${data.expired ? `<div class="state">Enlace expirado</div><div class="muted">Este enlace ya no está disponible.</div>` : `<div class="muted">Referencia</div><strong>${esc(data.reference)}</strong><div class="state">${esc(data.status)}</div><div class="muted">Línea de tiempo</div><ul>${timeline || '<li>Sin movimientos visibles.</li>'}</ul>`}</div></div></body></html>`);
  } catch (error) { next(error); }
});

module.exports = { notificationsPublicRouter: router, verifyMetaSignature };
