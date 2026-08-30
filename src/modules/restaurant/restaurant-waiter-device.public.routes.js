'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const service = require('./restaurant-waiter-device.service');

const router = express.Router();
const pairHtml = path.join(__dirname, '../../web/restaurant-waiter-pair.html');
const waiterPwaHtml = path.join(__dirname, '../../web/restaurant-waiter-pwa.html');
const adminScript = path.join(__dirname, '../../web/restaurant-waiter-device-admin.js');
const manifestFile = path.join(__dirname, '../../web/restaurant-waiter-manifest.webmanifest');
const swFile = path.join(__dirname, '../../web/restaurant-waiter-sw.js');
const iconFile = path.join(__dirname, '../../web/restaurant-waiter-icon.svg');
const icon192File = path.join(__dirname, '../../web/restaurant-waiter-icon-192.png');
const icon512File = path.join(__dirname, '../../web/restaurant-waiter-icon-512.png');

const WAITER_PWA_ENGINE_V5 = `<script id="vantixgc-waiter-engine-v5">
(()=>{
  'use strict';
  const SESSION_KEY='vantixgc_core_session_v1';
  const view=document.querySelector('#view');
  const message=document.querySelector('#message');
  let engineLoaded=false;
  let engineSettled=false;
  function renderState(title,detail,allowRetry=true){
    if(!view)return;
    view.innerHTML='';
    const card=document.createElement('section');card.className='ri-card';card.dataset.waiterBoot='state';card.style.maxWidth='720px';card.style.margin='22px auto';
    const eyebrow=document.createElement('div');eyebrow.className='ri-eyebrow';eyebrow.textContent='VANTIXGC MESERO';
    const heading=document.createElement('h1');heading.className='ri-title';heading.textContent=title;
    const copy=document.createElement('p');copy.className='ri-muted';copy.textContent=detail;
    card.append(eyebrow,heading,copy);
    if(allowRetry){const button=document.createElement('button');button.type='button';button.className='ri-btn primary';button.textContent='Reintentar';button.addEventListener('click',()=>location.reload());card.appendChild(button);}
    view.appendChild(card);
  }
  renderState('Cargando panel del mesero…','Verificando este dispositivo y la conexión con el restaurante.',false);
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}
  if(!saved?.token||!saved?.subdomain){
    engineSettled=true;
    if(message)message.innerHTML='';
    renderState('Este dispositivo no quedó vinculado','Vuelve a Empleados en el Centro de control, genera un QR nuevo y escanéalo desde este mismo navegador.',true);
    return;
  }
  const fail=(detail)=>{if(engineSettled)return;engineSettled=true;renderState('No se pudo abrir Mesero',detail||'Recarga la pantalla. Si continúa, genera un QR nuevo para este dispositivo.',true);};
  window.addEventListener('error',(event)=>{if(!engineLoaded)fail(event?.message||'La interfaz no terminó de cargar.');});
  window.addEventListener('unhandledrejection',(event)=>{if(!engineLoaded)fail(event?.reason?.message||'La interfaz no terminó de cargar.');});
  const engine=document.createElement('script');
  engine.src='/app/restaurant-ui.js?v=waiter-full-v5';
  engine.async=false;
  engine.onload=()=>{engineLoaded=true;document.documentElement.dataset.waiterEngine='v5';};
  engine.onerror=()=>fail('No fue posible descargar la interfaz del mesero. Revisa la conexión y vuelve a intentar.');
  document.head.appendChild(engine);
  setTimeout(()=>{
    if(engineSettled)return;
    const boot=view?.querySelector('[data-waiter-boot="state"]');
    if(boot){fail('El dispositivo está vinculado, pero el restaurante no respondió a tiempo. Reintenta; si persiste, genera un QR nuevo.');return;}
    engineSettled=true;
  },9000);
})();
</script>`;

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de vinculación inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const claimSchema = z.object({
  token: z.string().trim().min(20).max(300),
  deviceName: z.string().trim().max(80).optional().nullable()
});

router.get('/api/public/restaurante/mesero-dispositivo/vinculo', async (req, res, next) => {
  try {
    const token = String(req.query.t || '').trim();
    if (!token) throw new AppError(400, 'Falta el código de vinculación', 'RESTAURANT_WAITER_PAIRING_TOKEN_REQUIRED');
    res.json({ ok: true, data: await service.inspectPairing(token) });
  } catch (error) { next(error); }
});

router.post('/api/public/restaurante/mesero-dispositivo/vincular', async (req, res, next) => {
  try {
    const input = parse(claimSchema, req.body || {});
    const data = await service.claimPairing(input.token, { deviceName: input.deviceName, userAgent: req.get('user-agent') || '' });
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
});

router.get('/app/restaurant-waiter-device-admin.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(adminScript);
});

router.get('/app/centro-de-control/conectar', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(pairHtml);
});

router.get('/app/centro-de-control/mesero', async (_req, res, next) => {
  try {
    const source = await fs.promises.readFile(waiterPwaHtml, 'utf8');
    const rendered = source
      .replace('<script src="/app/restaurant-ui.js?v=waiter-full-v4"></script>', WAITER_PWA_ENGINE_V5)
      .replace(
        "const meseroTab=document.querySelector('[data-tab=\"mesero\"]');\n      if(!forced&&meseroTab){forced=true;meseroTab.click();}",
        "const meseroTab=document.querySelector('[data-tab=\"mesero\"]');\n      const firstOperationalView=view.querySelector('.salon-shell,.waiter-top-card,.kds-v2,.cash-shell');\n      if(!forced&&meseroTab&&firstOperationalView){forced=true;setTimeout(()=>meseroTab.click(),0);}"
      );
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-PWA', 'v5-recovery');
    res.type('html').send(rendered);
  } catch (error) { next(error); }
});

router.get('/app/centro-de-control/manifest.webmanifest', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/manifest+json').sendFile(manifestFile);
});

router.get('/app/centro-de-control/sw.js', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.set('Service-Worker-Allowed', '/app/centro-de-control');
  res.type('application/javascript').sendFile(swFile);
});

router.get('/app/centro-de-control/waiter-icon.svg', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml').sendFile(iconFile);
});

router.get('/app/centro-de-control/waiter-icon-192.png', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/png').sendFile(icon192File);
});

router.get('/app/centro-de-control/waiter-icon-512.png', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/png').sendFile(icon512File);
});

module.exports = { restaurantWaiterDevicePublicRouter: router };
