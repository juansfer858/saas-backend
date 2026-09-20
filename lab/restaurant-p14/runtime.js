'use strict';

const path = require('node:path');
const {
  P14_RUNTIME_CONTRACT,
  LOOPBACK_HOSTS,
  isAllowedClientAddress,
  assertRestaurantP14RuntimeConfig
} = require('./runtime-config');

const LOCAL_RESTAURANT_ENTRY = '/app/centro-de-control-v2';
const LOCAL_LOGIN_ENTRY = '/app';
const LOCAL_LOGIN_MARKER = 'VANTIX_RESTAURANT_P14_LOCAL_LOGIN_V1';
const RUNTIME_PHASE = 'P14-1A';
const CENTRAL_SUPER_CORE_UI_PREFIXES = Object.freeze([
  '/app/dashboard',
  '/app/ventas',
  '/app/compras',
  '/app/inventario',
  '/app/tesoreria',
  '/app/cartera',
  '/app/terceros',
  '/app/contabilidad',
  '/app/configuracion',
  '/app/configuracion-avanzada'
]);

function normalize(value) {
  return String(value || '').trim();
}

function tenantHeader(req) {
  return normalize(req?.headers?.['x-tenant-subdomain']).toLowerCase();
}

function isReadOnlyMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(normalize(method).toUpperCase());
}

function isCentralSuperCoreUiPath(rawPath) {
  const pathname = normalize(rawPath).split('?')[0];
  return CENTRAL_SUPER_CORE_UI_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function mutationBoundaryForRequest(method, rawPath) {
  const verb = normalize(method).toUpperCase();
  const pathname = normalize(rawPath).split('?')[0];
  if (verb === 'POST' && pathname === '/api/v1/auth/login') return 'AUTH_LOGIN';
  if (verb === 'POST' && /^\/api\/v1\/restaurante\/mesas\/[^/]+\/abrir$/.test(pathname)) return 'TABLE_OPEN_P14_2A';
  if (verb === 'POST' && /^\/api\/v1\/restaurante\/mesas\/[^/]+\/cancelar-apertura-v67$/.test(pathname)) return 'TABLE_EMPTY_CANCEL_P14_2A';
  return null;
}

function isAllowedOutboundTarget(rawUrl, config) {
  let target;
  try {
    target = new URL(normalize(rawUrl));
  } catch {
    return false;
  }

  const host = normalize(target.hostname).toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  return Boolean(config?.core?.syncEnabled && target.origin === config.core.url);
}

function installOutboundNetworkGuard(config) {
  if (typeof globalThis.fetch !== 'function' || globalThis.fetch.__vantixP14Guard) return;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const guardedFetch = async (input, init) => {
    const raw = typeof input === 'string' || input instanceof URL
      ? String(input)
      : String(input?.url || '');
    if (!isAllowedOutboundTarget(raw, config)) {
      throw new Error(`P14_OUTBOUND_BLOCKED: ${raw || '(URL vacía)'}`);
    }
    return nativeFetch(input, init);
  };
  guardedFetch.__vantixP14Guard = true;
  globalThis.fetch = guardedFetch;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[character]);
}

function localLoginHtml(config) {
  const tenant = JSON.stringify(config.tenantSubdomain);
  const entry = JSON.stringify(LOCAL_RESTAURANT_ENTRY);
  const localUrl = escapeHtml(config.http.localUrl);
  const installationId = escapeHtml(config.installationId);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>VantixGC Restaurante · Acceso local P14</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18221d;background:#f4f4f5}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(145deg,#eef3f0,#f7f7f6)}
    .card{width:min(440px,100%);background:#fff;border:1px solid #dde2df;border-radius:18px;padding:28px;box-shadow:0 18px 50px rgba(24,34,29,.10)}
    .brand{display:flex;gap:11px;align-items:center;margin-bottom:24px}.logo{width:38px;height:38px;border-radius:11px;background:#0d6b43;color:#fff;display:grid;place-items:center;font-weight:900}
    .brand b{display:block}.brand small{display:block;color:#61706a;margin-top:2px}.badge{display:inline-flex;padding:5px 9px;border-radius:999px;background:#ddf3e8;color:#0d6b43;font-size:12px;font-weight:800;margin-bottom:12px}
    h1{font-size:24px;margin:0 0 7px}p{color:#61706a;margin:0 0 22px}.field{margin:14px 0}.field label{display:block;font-size:13px;font-weight:750;margin-bottom:6px}
    .field input{width:100%;padding:11px 12px;border:1px solid #cfd7d2;border-radius:10px;font:inherit}.btn{width:100%;border:0;border-radius:10px;background:#0d6b43;color:#fff;padding:12px 14px;font:inherit;font-weight:800;cursor:pointer}.btn:disabled{opacity:.65}
    .error{margin:12px 0;padding:10px 12px;border-radius:9px;background:#fff1f0;color:#b42318;border:1px solid #fecaca;font-size:13px}.meta{margin-top:14px;color:#61706a;font-size:12px;line-height:1.5}
  </style>
</head>
<body data-p14-local-login="${LOCAL_LOGIN_MARKER}">
  <form class="card" id="loginForm">
    <div class="brand"><div class="logo">V</div><div><b>VantixGC Restaurante</b><small>P14 · piloto local-first aislado</small></div></div>
    <div class="badge">OPERACIÓN LOCAL · ${localUrl}</div>
    <h1>Ingresar al restaurante</h1>
    <p>Esta sesión pertenece únicamente a la instalación piloto de casa.</p>
    <div id="errorBox"></div>
    <div class="field"><label>Correo electrónico</label><input name="email" type="email" value="admin@demo-restaurante.vantixgc.com" required autocomplete="username"></div>
    <div class="field"><label>Contraseña piloto</label><input name="password" type="password" required autocomplete="current-password"></div>
    <button class="btn" id="submit" type="submit">Ingresar</button>
    <div class="meta">Tenant: demo-restaurante<br>Instalación: ${installationId}<br>Super Core y QR permanecen en Internet.</div>
  </form>
  <script>
  (()=>{'use strict';
    const tenant=${tenant};const entry=${entry};const key='vantixgc_core_session_v1';
    const form=document.getElementById('loginForm');const box=document.getElementById('errorBox');const submit=document.getElementById('submit');
    const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
    try{const existing=JSON.parse(localStorage.getItem(key)||'null');if(existing?.token&&existing?.subdomain===tenant){location.replace(entry);return}}catch{}
    form.addEventListener('submit',async event=>{event.preventDefault();box.innerHTML='';submit.disabled=true;submit.textContent='Ingresando…';const data=new FormData(form);
      try{const loginResponse=await fetch('/api/v1/auth/login',{method:'POST',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json','x-tenant-subdomain':tenant},body:JSON.stringify({email:String(data.get('email')||'').trim(),password:String(data.get('password')||'')})});let login={};try{login=await loginResponse.json()}catch{}if(!loginResponse.ok||!login?.data?.token)throw new Error(login?.error?.message||login?.message||'Credenciales inválidas');
        const token=login.data.token;const sessionResponse=await fetch('/api/v1/auth/session',{cache:'no-store',headers:{Accept:'application/json',Authorization:'Bearer '+token,'x-tenant-subdomain':tenant}});let session={};try{session=await sessionResponse.json()}catch{}if(!sessionResponse.ok||!session?.data?.tenant||!session?.data?.user)throw new Error(session?.error?.message||'No fue posible abrir la sesión local');
        localStorage.setItem(key,JSON.stringify({token,subdomain:tenant,tenant:session.data.tenant,user:session.data.user}));location.replace(entry);
      }catch(error){box.innerHTML='<div class="error">'+esc(error?.message||'No fue posible iniciar sesión')+'</div>';submit.disabled=false;submit.textContent='Ingresar'}
    });
  })();
  </script>
</body>
</html>`;
}

function installClientNetworkBoundary(config) {
  return (req, res, next) => {
    const remoteAddress = req?.socket?.remoteAddress || req?.ip || '';
    if (isAllowedClientAddress(config, remoteAddress)) return next();
    return res.status(403).json({
      ok: false,
      code: 'P14_LAN_CLIENT_DENIED',
      message: 'Este dispositivo no pertenece a la red privada autorizada para el piloto.'
    });
  };
}

function installPilotBoundary(config) {
  return (req, res, next) => {
    res.set('X-VantixGC-P14-Pilot', P14_RUNTIME_CONTRACT.marker);
    res.set('X-VantixGC-P14-Installation', config.installationId);
    res.set('X-VantixGC-P14-Phase', RUNTIME_PHASE);

    const requestedTenant = tenantHeader(req);
    if (requestedTenant && requestedTenant !== config.tenantSubdomain) {
      return res.status(403).json({
        ok: false,
        code: 'P14_TENANT_LOCK_MISMATCH',
        message: 'Este runtime local pertenece a otro tenant.'
      });
    }

    if (req.path === '/platform' || req.path.startsWith('/platform/') || req.path.startsWith('/edge/api/')) {
      return res.status(404).json({
        ok: false,
        code: 'P14_CONTROL_PLANE_CLOUD_ONLY',
        message: 'El plano de control permanece únicamente en Super Core.'
      });
    }

    if (isCentralSuperCoreUiPath(req.path)) {
      return res.status(404).json({
        ok: false,
        code: 'P14_SUPER_CORE_UI_CLOUD_ONLY',
        message: 'Esta superficie administrativa permanece únicamente en Internet.'
      });
    }

    if (req.path.startsWith('/r/')) {
      return res.status(409).json({
        ok: false,
        code: 'P14_PUBLIC_QR_CORE_ONLY',
        message: 'El QR público permanece únicamente en Super Core.'
      });
    }

    if (isReadOnlyMethod(req.method)) return next();

    const boundary = mutationBoundaryForRequest(req.method, req.path);
    if (boundary) {
      if (!requestedTenant) {
        return res.status(400).json({
          ok: false,
          code: 'P14_TENANT_HEADER_REQUIRED',
          message: 'Falta el tenant local.'
        });
      }
      res.set('X-VantixGC-P14-Mutation-Boundary', boundary);
      return next();
    }

    return res.status(423).json({
      ok: false,
      code: 'P14_OPERATIONAL_MUTATIONS_LOCKED',
      message: 'P14 mantiene bloqueados Pedidos, Cocina, Caja e impresión. En esta frontera solo están habilitadas la apertura y la cancelación de mesas vacías.'
    });
  };
}

async function start(env = process.env) {
  const config = assertRestaurantP14RuntimeConfig(env);

  process.env.JWT_SECRET = normalize(env.P14_JWT_SECRET);
  process.env.DIAN_EMBEDDED_WORKER_ENABLED = 'false';
  process.env.NOTIFICATION_EMBEDDED_WORKER_ENABLED = 'false';
  process.env.DISABLE_RESTAURANT_DEMO_BOOTSTRAP = 'true';
  process.env.PUBLIC_TENANT_REGISTRATION_ENABLED = 'false';
  process.env.VANTIX_P14_LOCAL_RUNTIME = 'true';
  installOutboundNetworkGuard(config);

  const express = require('express');
  const { app: canonicalCoreApp } = require('../../src/app');
  const { prisma } = require('../../src/config/prisma');

  const local = express();
  local.disable('x-powered-by');
  local.use(express.json({ limit: '256kb' }));
  local.use(installClientNetworkBoundary(config));

  const sendLocalLogin = (_req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-VantixGC-P14-Local-Login', LOCAL_LOGIN_MARKER);
    return res.type('html').send(localLoginHtml(config));
  };

  local.get('/', (_req, res) => res.redirect(302, LOCAL_RESTAURANT_ENTRY));
  local.get(LOCAL_LOGIN_ENTRY, sendLocalLogin);
  local.get('/app/login', sendLocalLogin);
  local.get('/app/centro-de-control', (_req, res) => res.redirect(302, LOCAL_RESTAURANT_ENTRY));

  local.get('/__p14/status', (_req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('X-VantixGC-P14-Pilot', P14_RUNTIME_CONTRACT.marker);
    return res.json({
      ok: true,
      marker: config.marker,
      phase: RUNTIME_PHASE,
      tenantSubdomain: config.tenantSubdomain,
      installationId: config.installationId,
      releaseChannel: config.releaseChannel,
      operationalMode: config.operationalMode,
      localSurface: 'RESTAURANT_V2_CANONICAL_READ_ONLY',
      localEntry: LOCAL_RESTAURANT_ENTRY,
      localLogin: LOCAL_LOGIN_ENTRY,
      http: config.http,
      database: config.database,
      core: config.core,
      security: config.security,
      mutationBoundaries: ['AUTH_LOGIN'],
      allOperationalMutations: 'LOCKED_UNTIL_P14_1A_PASSES',
      superCoreUi: 'CLOUD_ONLY',
      publicQrPolicy: 'CORE_CLOUD_ONLY',
      productionEdgePortUntouched: config.productionEdgePortUntouched
    });
  });

  local.use(installPilotBoundary(config));
  local.use(canonicalCoreApp);

  const server = await new Promise((resolve, reject) => {
    const instance = local.listen(config.http.port, config.http.bindHost, () => resolve(instance));
    instance.once('error', reject);
  });

  console.log(`P14_RUNTIME_READY phase=${RUNTIME_PHASE} tenant=${config.tenantSubdomain} installation=${config.installationId} url=${config.http.localUrl}`);

  const shutdown = async (signal) => {
    console.log(`P14_RUNTIME_STOP signal=${signal}`);
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return { server, config };
}

if (require.main === module) {
  require('dotenv').config({ path: process.env.P14_ENV_FILE || path.join(__dirname, '.env') });
  start(process.env).catch((error) => {
    console.error(`P14_RUNTIME_FAILED: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  LOCAL_RESTAURANT_ENTRY,
  LOCAL_LOGIN_ENTRY,
  LOCAL_LOGIN_MARKER,
  RUNTIME_PHASE,
  CENTRAL_SUPER_CORE_UI_PREFIXES,
  tenantHeader,
  isReadOnlyMethod,
  isCentralSuperCoreUiPath,
  mutationBoundaryForRequest,
  isAllowedOutboundTarget,
  installOutboundNetworkGuard,
  escapeHtml,
  localLoginHtml,
  installClientNetworkBoundary,
  installPilotBoundary,
  start
};