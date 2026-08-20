const assert = require('node:assert/strict');
const http = require('node:http');
const { prisma } = require('../src/config/prisma');

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}
function close(server) { return new Promise((resolve) => server.close(() => resolve())); }
async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }

async function main() {
  const calls = [];
  const fakeMeta = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const payload = ['POST','PUT','DELETE'].includes(req.method) ? await readBody(req) : {};
    calls.push({ method: req.method, path: url.pathname, auth: req.headers.authorization || null, query: Object.fromEntries(url.searchParams), payload });
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/v24.0/oauth/access_token') return res.end(JSON.stringify({ access_token: 'BUSINESS-TOKEN-REAL-CONTRACT', token_type: 'bearer', expires_in: 3600 }));
    if (url.pathname === '/v24.0/debug_token') return res.end(JSON.stringify({ data: { is_valid: true, app_id: 'APP-REAL', type: 'USER', scopes: ['whatsapp_business_management'], granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA-REAL'] }] } }));
    if (url.pathname === '/v24.0/WABA-REAL/subscribed_apps' && req.method === 'POST') return res.end(JSON.stringify({ success: true }));
    if (url.pathname === '/v24.0/PHONE-REAL' && req.method === 'GET') return res.end(JSON.stringify({ id: 'PHONE-REAL', display_phone_number: '+573001112233', verified_name: 'VantixGC QA', quality_rating: 'GREEN' }));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: `Unexpected fake Meta path ${url.pathname}` } }));
  });
  const port = await listen(fakeMeta);

  process.env.JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.NOTIFICATION_CREDENTIALS_SECRET = 'notifications-secret-0123456789abcdef0123456789abcdef0123456789';
  process.env.META_APP_ID = 'APP-REAL';
  process.env.META_APP_SECRET = 'APP-SECRET-REAL';
  process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = 'CONFIG-SYSTEM-USER-60D';
  process.env.META_GRAPH_VERSION = 'v24.0';
  process.env.META_GRAPH_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-real-contract';
  process.env.VANTIXGC_PUBLIC_BASE_URL = 'https://core.vantixgc.com';

  const tech = require('../src/modules/notifications/meta-tech-provider.service');
  const realSignup = require('../src/modules/notifications/meta-real-signup.service');

  const systemToken = 'SYSTEM-USER-TOKEN-MUST-NOT-APPEAR-PLAINTEXT-1234567890';
  const status = await tech.saveSystemUserToken({ token: systemToken, expiresAt: new Date(Date.now() + 60 * 86400000), label: 'SYSTEM_USER_60_DAYS', updatedBy: 'CI' });
  assert.equal(status.configured, true);
  assert.equal(status.configurationId, 'CONFIG-SYSTEM-USER-60D');
  assert.equal(status.webhookUrl, 'https://core.vantixgc.com/webhooks/whatsapp');
  const stored = await prisma.metaTechProviderCredential.findUnique({ where: { id: 'META_TECH_PROVIDER' } });
  assert.ok(stored.systemUserTokenCiphertext);
  assert.equal(stored.systemUserTokenCiphertext.includes(systemToken), false);

  const stamp = Date.now();
  const tenant = await prisma.tenant.create({ data: { nombreEmpresa: `Meta Real QA ${stamp}`, subdomain: `meta-real-${stamp}`, nicho: 'CORE_QA', pais: 'CO', moneda: 'COP' } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, nombre: 'Admin Meta Real', email: `meta-real-${stamp}@example.com`, password: 'not-login', rol: 'ADMIN' } });
  const connected = await realSignup.completeEmbeddedSignup(tenant.id, admin.id, { code: 'AUTH-CODE-REAL', wabaId: 'WABA-REAL', phoneNumberId: 'PHONE-REAL' });
  assert.equal(connected.connected, true);
  assert.equal(connected.displayPhoneNumber, '+573001112233');

  const debugCall = calls.find((x) => x.path === '/v24.0/debug_token');
  const subscribeCall = calls.find((x) => x.path === '/v24.0/WABA-REAL/subscribed_apps');
  const phoneCall = calls.find((x) => x.path === '/v24.0/PHONE-REAL');
  assert.equal(debugCall.auth, `Bearer ${systemToken}`);
  assert.equal(subscribeCall.auth, `Bearer ${systemToken}`);
  assert.equal(phoneCall.auth, 'Bearer BUSINESS-TOKEN-REAL-CONTRACT');

  const row = await prisma.notificationTenantConfig.findUnique({ where: { tenantId: tenant.id } });
  assert.ok(row.accessTokenCiphertext);
  assert.equal(row.accessTokenCiphertext.includes('BUSINESS-TOKEN-REAL-CONTRACT'), false);
  const audit = await prisma.notificationAudit.findFirst({ where: { tenantId: tenant.id, action: 'WHATSAPP_REAL_EMBEDDED_SIGNUP_COMPLETED' } });
  assert.ok(audit);
  const ready = await tech.readiness();
  assert.ok(ready.lastRealSignupAt);

  console.log('META REAL CONNECTION CONTRACT SMOKE OK');
  console.log(JSON.stringify({
    correctConfigurationIdWired: true,
    systemUserTokenEncryptedAtRest: true,
    systemUserTokenUsedForManagementCalls: true,
    businessTokenUsedForTenantPhoneCalls: true,
    wabaScopeValidated: true,
    tenantBusinessTokenEncryptedAtRest: true,
    webhookProductionUrl: ready.webhookUrl,
    realMetaPopupOtpExecuted: false
  }, null, 2));

  await close(fakeMeta);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
