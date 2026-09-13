'use strict';

const express = require('express');

const router = express.Router();
const HEADER_VALUE = 'p12-v2-only-runtime';
const SW_MARKER = 'VANTIX_RESTAURANT_V1_SW_RETIREMENT_P12';

const TARGETS = Object.freeze({
  controlCenter: '/app/centro-de-control-v2',
  waiter: '/app/centro-de-control/mesero-v2/',
  production: '/app/produccion-v2/'
});

const LEGACY_SW_RETIREMENT = `'use strict';
const MARKER='${SW_MARKER}';
const LEGACY_PREFIXES=['vantixgc-waiter-shell-','vantixgc-production-','vantixgc-restaurant-production-','vantixgc-restaurant-v1-'];
self.addEventListener('install',event=>{event.waitUntil(Promise.resolve());self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{
  try{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>LEGACY_PREFIXES.some(prefix=>key.startsWith(prefix))).map(key=>caches.delete(key)));
  }catch{}
  try{await self.clients.claim()}catch{}
  try{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients){try{client.postMessage({type:MARKER,v1Runtime:false,v2Only:true})}catch{}}
  }catch{}
  try{await self.registration.unregister()}catch{}
})())});
`;

// Bridge cloud -> Edge para el primer vínculo del PC. El navegador nunca construye
// la URL local con datos de la query: la única URL aceptada para volver al Edge es
// data.localUrl emitida por Core después de validar tenant, agente y returnOrigin.
const EDGE_LINK_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VantixGC Restaurantes · Vincular sede</title>
<style>
:root{--bg:#f4f4f5;--card:#fff;--line:#e4e4e7;--text:#18221d;--muted:#61706a;--green:#0d6b43;--red:#b42318;--soft:#ddf3e8}*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}.wrap{min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(460px,100%);background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px}.brand{color:var(--green);font-weight:900}.muted{color:var(--muted)}.status{margin:16px 0;padding:12px;border-radius:10px;background:var(--soft)}.error{background:#fff1f0;color:var(--red);border:1px solid #fecaca}.field{margin:13px 0}.field label{display:block;font-size:13px;font-weight:750;margin-bottom:6px}.field input{width:100%;padding:10px 11px;border:1px solid #d0d5dd;border-radius:9px;font:inherit}.btn{display:inline-block;border:1px solid var(--line);background:#fff;color:var(--text);padding:10px 14px;border-radius:9px;font:inherit;font-weight:800;cursor:pointer;text-decoration:none}.primary{width:100%;background:var(--green);border-color:var(--green);color:#fff}.hidden{display:none}.actions{display:flex;gap:8px;margin-top:14px}.actions .btn{flex:1;text-align:center}</style>
</head>
<body><main class="wrap"><section class="card"><div class="brand">VantixGC Restaurantes</div><h1>Vincular esta sede</h1><p class="muted">Estamos autorizando este PC para que el restaurante pueda trabajar desde su Edge local, incluso si se cae Internet.</p><div id="status" class="status">Comprobando tu sesión…</div><form id="login" class="hidden"><div class="field"><label>Subdominio de empresa</label><input id="subdomain" autocomplete="organization" required></div><div class="field"><label>Correo electrónico</label><input id="email" type="email" autocomplete="username" required></div><div class="field"><label>Contraseña</label><input id="password" type="password" autocomplete="current-password" required></div><button class="btn primary" type="submit">Autorizar este PC</button></form><div class="actions"><a class="btn" href="/app/centro-de-control-v2">Volver a la nube</a></div></section></main>
<script>
'use strict';
(function(){
  const SESSION_KEY='vantixgc_core_session_v1';
  const params=new URLSearchParams(location.search);
  const agentId=String(params.get('edge')||'').trim();
  const returnOrigin=String(params.get('return')||'').trim();
  const statusEl=document.getElementById('status');
  const form=document.getElementById('login');
  const subdomainEl=document.getElementById('subdomain');
  const emailEl=document.getElementById('email');
  const passwordEl=document.getElementById('password');

  function setStatus(text,error){
    statusEl.textContent=text;
    statusEl.className='status'+(error?' error':'');
  }
  function readSession(){
    try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}
  }
  function saveSession(value){
    localStorage.setItem(SESSION_KEY,JSON.stringify(value));
  }
  function showLogin(session,message){
    if(session&&session.subdomain)subdomainEl.value=session.subdomain;
    if(session&&session.user&&session.user.email)emailEl.value=session.user.email;
    passwordEl.value='';
    form.classList.remove('hidden');
    setStatus(message||'Inicia sesión para autorizar este PC.',Boolean(message));
  }
  async function readJson(response){
    try{return await response.json()}catch{return {}}
  }
  async function grant(session){
    if(!agentId||!returnOrigin)throw new Error('Faltan los datos de vinculación del Edge.');
    if(!session||!session.token||!session.subdomain){
      showLogin(session);
      return false;
    }
    setStatus('Autorizando el Edge local…',false);
    const response=await fetch('/api/v1/edge/agents/'+encodeURIComponent(agentId)+'/local-access-grant',{
      method:'POST',
      cache:'no-store',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+session.token,
        'x-tenant-subdomain':session.subdomain
      },
      body:JSON.stringify({returnOrigin:returnOrigin})
    });
    const body=await readJson(response);
    if(response.status===401||response.status===403){
      showLogin(session,body&&body.error&&body.error.message?body.error.message:'La sesión no puede autorizar este PC. Ingresa nuevamente.');
      return false;
    }
    if(!response.ok)throw new Error((body&&body.error&&body.error.message)||body.message||('Error HTTP '+response.status));
    const localUrl=body&&body.data&&body.data.localUrl;
    if(!localUrl)throw new Error('Core no devolvió una dirección local autorizada.');
    setStatus('Autorización lista. Regresando al Edge local…',false);
    location.replace(localUrl);
    return true;
  }
  async function loginAndGrant(event){
    event.preventDefault();
    form.classList.add('hidden');
    try{
      const subdomain=String(subdomainEl.value||'').trim().toLowerCase();
      setStatus('Validando tu cuenta…',false);
      const loginResponse=await fetch('/api/v1/auth/login',{
        method:'POST',
        cache:'no-store',
        headers:{'Content-Type':'application/json','x-tenant-subdomain':subdomain},
        body:JSON.stringify({email:String(emailEl.value||'').trim(),password:String(passwordEl.value||'')})
      });
      const loginBody=await readJson(loginResponse);
      if(!loginResponse.ok)throw new Error((loginBody&&loginBody.error&&loginBody.error.message)||loginBody.message||'Credenciales inválidas');
      const token=loginBody&&loginBody.data&&loginBody.data.token;
      if(!token)throw new Error('No fue posible crear la sesión.');
      const sessionResponse=await fetch('/api/v1/auth/session',{
        cache:'no-store',
        headers:{'Authorization':'Bearer '+token,'x-tenant-subdomain':subdomain}
      });
      const sessionBody=await readJson(sessionResponse);
      if(!sessionResponse.ok)throw new Error((sessionBody&&sessionBody.error&&sessionBody.error.message)||sessionBody.message||'No fue posible abrir la sesión');
      const session={token:token,subdomain:subdomain,tenant:sessionBody.data.tenant,user:sessionBody.data.user};
      saveSession(session);
      await grant(session);
    }catch(error){
      showLogin(readSession(),error&&error.message?error.message:String(error));
    }
  }

  form.addEventListener('submit',loginAndGrant);
  const current=readSession();
  grant(current).catch(function(error){showLogin(current,error&&error.message?error.message:String(error))});
})();
</script></body></html>`;

function noStore(res) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V2-Only', HEADER_VALUE);
  res.set('X-VantixGC-Restaurant-V1-Runtime', 'disabled');
}

function querySuffix(req) {
  const index = String(req.originalUrl || '').indexOf('?');
  return index >= 0 ? String(req.originalUrl).slice(index) : '';
}

function redirectV2(req, res, target, source) {
  noStore(res);
  res.set('X-VantixGC-Restaurant-V1-Redirect-From', source);
  return res.redirect(307, `${target}${querySuffix(req)}`);
}

function hasEdgeLinkIntent(req) {
  return Boolean(String(req.query?.edge || '').trim() && String(req.query?.return || '').trim());
}

function edgeLinkBridge(res) {
  noStore(res);
  res.set('X-VantixGC-Restaurant-UI', 'EDGE-LINK-P12');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.status(200).type('html').send(EDGE_LINK_HTML);
}

function redirectV2OrLinkEdge(req, res) {
  if (hasEdgeLinkIntent(req)) return edgeLinkBridge(res);
  return redirectV2(req, res, TARGETS.controlCenter, 'centro-de-control');
}

function retiredWorker(res, allowedScope) {
  noStore(res);
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Service-Worker-Allowed', allowedScope);
  res.set('X-VantixGC-Restaurant-V1-Service-Worker', 'retired');
  return res.type('application/javascript; charset=utf-8').send(LEGACY_SW_RETIREMENT);
}

// Retire the two broad legacy workers before any V1/P10 router can serve them.
// The V2 workers use independent narrower scopes and are not deleted here.
router.get('/app/centro-de-control/sw.js', (_req, res) => retiredWorker(res, '/app/centro-de-control'));
router.get('/app/produccion/sw.js', (_req, res) => retiredWorker(res, '/app/produccion'));

// P12 sigue enviando toda entrada normal a V2. La única excepción es el primer
// vínculo Edge explícito (?edge=...&return=...), que debe completar el grant local
// y volver al workspace de la sede en vez de quedarse operando en la nube.
router.get('/app/centro-de-control', redirectV2OrLinkEdge);
router.get('/app/restaurante', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'restaurante'));
router.get('/app/centro-de-control/mesero', (req, res) => redirectV2(req, res, TARGETS.waiter, 'mesero-canonical'));
router.get('/app/produccion', (req, res) => redirectV2(req, res, TARGETS.production, 'produccion-canonical'));

// Direct V1/P10 rescue URLs are no longer executable in normal SaaS runtime.
// Source code remains frozen in git so rollback requires an intentional code change.
router.get('/app/restaurante-v1', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'restaurante-v1'));
router.get('/app/centro-de-control-p10', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'centro-de-control-p10'));
router.get('/app/centro-de-control/mesero-v1', (req, res) => redirectV2(req, res, TARGETS.waiter, 'mesero-v1'));
router.get('/app/produccion-v1', (req, res) => redirectV2(req, res, TARGETS.production, 'produccion-v1'));
router.get('/app/centro-de-control-preview', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'centro-de-control-preview'));

// Migration/retirement control screens are historical after P12. Prevent operators
// from reopening the V1 decision surface and return them to the live V2 workspace.
router.get('/app/restaurante-v2/migracion', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'migracion-p10'));
router.get('/app/restaurante-v2/retiro-v1', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'retiro-v1-p11'));

module.exports = {
  HEADER_VALUE,
  SW_MARKER,
  TARGETS,
  LEGACY_SW_RETIREMENT,
  EDGE_LINK_HTML,
  restaurantV2OnlyP12PublicRouter: router
};
