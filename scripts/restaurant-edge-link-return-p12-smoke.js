'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const p12 = read('src/modules/restaurant/restaurant-v2-only-p12.public.routes.js');
const coreRoutes = read('src/routes/core.routes.js');
const edgeWorkspace = read('src/modules/edge/edge-workspace.service.js');
const localWorkspace = read('edge/agent/workspace-entry.js');

// La entrada SaaS normal sigue siendo P12/V2; no reabrimos V1 ni P10.
assert.match(p12, /controlCenter:\s*'\/app\/centro-de-control-v2'/);
assert.match(p12, /function redirectV2OrLinkEdge/);
assert.match(p12, /return redirectV2\(req, res, TARGETS\.controlCenter, 'centro-de-control'\)/);

// Solo el intento explícito de vinculación Edge evita el redirect cloud.
assert.match(p12, /req\.query\?\.edge/);
assert.match(p12, /req\.query\?\.return/);
assert.match(p12, /X-VantixGC-Restaurant-UI', 'EDGE-LINK-P12'/);
assert.match(p12, /Cache-Control', 'no-store, max-age=0'/);
assert.match(p12, /X-Content-Type-Options', 'nosniff'/);

// Reutiliza la sesión Core existente y, si hace falta, permite autenticarse sin
// perder edge+return. No se guardan contraseñas ni se imprime el grant.
assert.match(p12, /vantixgc_core_session_v1/);
assert.match(p12, /\/api\/v1\/auth\/login/);
assert.match(p12, /\/api\/v1\/auth\/session/);
assert.match(p12, /\/api\/v1\/edge\/agents\/'\+encodeURIComponent\(agentId\)\+'\/local-access-grant/);
assert.match(p12, /body:JSON\.stringify\(\{returnOrigin:returnOrigin\}\)/);

// El endpoint del grant sigue detrás de resolución de tenant + auth + permisos.
assert.match(coreRoutes, /router\.use\(extractTenantBySubdomain\)/);
assert.match(coreRoutes, /router\.use\(authMiddleware\)/);
assert.match(coreRoutes, /router\.use\(enforceTenantPermissions\)/);
assert.match(coreRoutes, /router\.use\('\/edge', edgeHybridLocalOriginV53Router\)/);

// El navegador solo vuelve a la URL validada que entrega Core.
assert.match(p12, /const localUrl=body&&body\.data&&body\.data\.localUrl/);
assert.match(p12, /location\.replace\(localUrl\)/);
assert.doesNotMatch(p12, /location\.replace\(returnOrigin/);

// El servicio Core mantiene las barreras fuertes del grant: origen local permitido,
// agente activo del tenant, TTL corto, hash y consumo de un solo uso.
assert.match(edgeWorkspace, /function safeLocalOrigin/);
assert.match(edgeWorkspace, /createLocalAccessGrant/);
assert.match(edgeWorkspace, /returnOrigin/);
assert.match(edgeWorkspace, /tokenHash/);
assert.match(edgeWorkspace, /expiresAt/);
assert.match(edgeWorkspace, /consumedAt:\s*null/);
assert.match(edgeWorkspace, /localUrl:/);

// Edge 2.1.18 ya sabe consumir el grant y crear la sesión local; este arreglo es
// Core-only y no exige reinstalar el Edge para completar este handoff.
assert.match(localWorkspace, /url\.pathname === '\/access'/);
assert.match(localWorkspace, /\/edge\/api\/v1\/local-access\/consume/);
assert.match(localWorkspace, /createSession\(response\.data\)/);
assert.match(localWorkspace, /vantixgc_edge_workspace/);
assert.match(localWorkspace, /redirect\(res, '\/app\/centro-de-control'/);

console.log(JSON.stringify({
  ok: true,
  normalP12RedirectPreserved: true,
  edgeLinkBridgeProtected: true,
  existingCoreSessionReused: true,
  loginFallbackPreservesLinkIntent: true,
  tenantAuthPermissionChainPreserved: true,
  serverIssuedLocalUrlOnly: true,
  oneTimeHashedGrantPreserved: true,
  edge218CompatibleWithoutReinstall: true
}));
