const crypto = require('node:crypto');
const express = require('express');
const service = require('./notifications.service');
const techProvider = require('./meta-tech-provider.service');
const { AppError } = require('../../utils/app-error');
const { publicInstallerRouter } = require('../public-installer/public-installer.routes');

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

function hasAccountUpdate(payload) {
  return (payload?.entry || []).some((entry) => (entry.changes || []).some((change) => String(change.field || '').toLowerCase() === 'account_update'));
}

// Public installer landing: /instalar, /instalar-restaurantes and /demo-restaurantes.
router.use('/', publicInstallerRouter);

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
    await techProvider.touch({
      lastLiveWebhookAt: new Date(),
      ...(hasAccountUpdate(req.body) ? { lastAccountUpdateAt: new Date() } : {}),
      updatedBy: 'META_SIGNED_WEBHOOK'
    });
    res.status(200).json({ ok: true });
  } catch (error) { next(error); }
});

router.get('/app/notificaciones-coexistencia', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Coexistencia · VantixGC</title>
<style>
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f4f4f5;color:#18221d}.wrap{max-width:760px;margin:0 auto;padding:28px}.card{background:white;border:1px solid #e4e4e7;border-radius:16px;padding:22px;margin:14px 0}.brand{font-weight:850;color:#0d6b43}.muted{color:#61706a}.btn{border:0;border-radius:10px;padding:11px 16px;font-weight:800;cursor:pointer;background:#0d6b43;color:white}.btn:disabled{opacity:.5;cursor:not-allowed}.notice{margin-top:14px;padding:12px;border-radius:10px;background:#ecfdf3;border:1px solid #b7dfc8}.error{margin-top:14px;padding:12px;border-radius:10px;background:#fff1f0;border:1px solid #fecaca;color:#b42318}.back{color:#0d6b43;text-decoration:none;font-weight:700}
</style></head>
<body><div class="wrap"><div class="brand">VantixGC Super Core</div><h1>Conectar WhatsApp Business actual</h1>
<p class="muted">Modo Coexistencia: el mismo número sigue funcionando en la app WhatsApp Business del celular y también queda conectado a VantixGC por Cloud API.</p>
<div class="card"><strong>Antes de continuar</strong><p class="muted">Usa el teléfono donde ya tienes activa la app WhatsApp Business. Meta guiará la verificación dentro de su popup oficial. VantixGC no te pedirá tokens ni claves técnicas.</p>
<button class="btn" id="start" disabled>Cargando Meta…</button><div id="status"></div></div>
<a class="back" href="/app/configuracion-avanzada">← Volver a Configuración avanzada</a></div>
<script>
const sessionKey='vantixgc_core_session_v1';let session=null;try{session=JSON.parse(localStorage.getItem(sessionKey)||'null')}catch{}if(!session)location.replace('/app/login');
const status=document.querySelector('#status'),start=document.querySelector('#start');
function show(msg,error=false){status.innerHTML='<div class="'+(error?'error':'notice')+'">'+String(msg).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))+'</div>'}
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token,'x-tenant-subdomain':session.subdomain,...(opts.headers||{})}});let b={};try{b=await r.json()}catch{}if(!r.ok)throw new Error(b?.error?.message||'HTTP '+r.status);return b}
async function loadSdk(){if(window.FB)return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://connect.facebook.net/es_LA/sdk.js';s.async=true;s.defer=true;s.onload=resolve;s.onerror=()=>reject(new Error('No fue posible cargar Meta SDK'));document.head.appendChild(s)})}
(async()=>{try{const cfg=(await api('/api/v1/notificaciones/embedded-signup/config')).data||{};if(!cfg.ready)throw new Error('Embedded Signup no está listo en el servidor.');await loadSdk();FB.init({appId:cfg.appId,autoLogAppEvents:true,xfbml:false,version:cfg.graphVersion});start.disabled=false;start.textContent='Conectar mi WhatsApp Business actual';start.onclick=()=>launch(cfg)}catch(e){show(e.message,true)}})();
function launch(cfg){let embedded=null,code=null,completed=false;const cleanup=()=>window.removeEventListener('message',onMessage);const maybeComplete=async()=>{if(completed||!embedded?.wabaId||!code)return;completed=true;start.disabled=true;show('Meta terminó el registro. Validando la coexistencia en VantixGC…');try{const result=await api('/api/v1/notificaciones/embedded-signup/complete',{method:'POST',body:JSON.stringify({code,wabaId:embedded.wabaId,phoneNumberId:embedded.phoneNumberId||null,onboardingMode:'COEXISTENCE'})});cleanup();show('WhatsApp Business conectado en modo coexistencia. Número: '+(result.data?.displayPhoneNumber||'confirmado por Meta'));setTimeout(()=>location.href='/app/configuracion-avanzada',1800)}catch(e){completed=false;start.disabled=false;show(e.message,true)}};
const onMessage=(event)=>{if(!['https://www.facebook.com','https://web.facebook.com'].includes(event.origin))return;let data=event.data;try{if(typeof data==='string')data=JSON.parse(data)}catch{return}if(data?.type!=='WA_EMBEDDED_SIGNUP')return;if(['FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING','FINISH'].includes(data.event)){embedded={wabaId:data.data?.waba_id,phoneNumberId:data.data?.phone_number_id||null};maybeComplete()}};window.addEventListener('message',onMessage);
FB.login((response)=>{code=response?.authResponse?.code||null;if(!code){cleanup();show('Meta no devolvió el código de autorización.',true);return}maybeComplete()},{config_id:cfg.configId,response_type:'code',override_default_response_type:true,extras:{setup:{},featureType:'whatsapp_business_app_onboarding',sessionInfoVersion:'3'}})}
</script></body></html>`);
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
