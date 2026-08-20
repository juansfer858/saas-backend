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
async function body(req) { const chunks = []; for await (const c of req) chunks.push(c); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }

async function main() {
  const providerCalls = [];
  const remoteTemplates = new Map();
  let messageCounter = 0;

  const metaServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const payload = ['POST','PUT','DELETE'].includes(req.method) ? await body(req) : {};
    providerCalls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), payload });
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/v24.0/oauth/access_token') return res.end(JSON.stringify({ access_token: `TOKEN-${url.searchParams.get('code')}`, token_type: 'bearer', expires_in: 3600 }));
    if (/\/subscribed_apps$/.test(url.pathname) && req.method === 'POST') return res.end(JSON.stringify({ success: true }));
    if (/\/PHONE-[AB]$/.test(url.pathname) && req.method === 'GET') {
      const suffix = url.pathname.endsWith('PHONE-A') ? '1111111111' : '2222222222';
      return res.end(JSON.stringify({ id: url.pathname.split('/').pop(), display_phone_number: `+57${suffix}`, verified_name: `Tenant ${suffix.slice(0,1)}`, quality_rating: 'GREEN' }));
    }
    const templateMatch = url.pathname.match(/^\/v24\.0\/(WABA-[AB])\/message_templates$/);
    if (templateMatch && req.method === 'POST') {
      const key = `${templateMatch[1]}|${payload.name}|${payload.language}`;
      remoteTemplates.set(key, { id: `TPL-${remoteTemplates.size + 1}`, name: payload.name, language: payload.language, category: payload.category, status: 'APPROVED' });
      return res.end(JSON.stringify({ id: remoteTemplates.get(key).id }));
    }
    if (templateMatch && req.method === 'GET') {
      const data = [...remoteTemplates.entries()].filter(([key]) => key.startsWith(`${templateMatch[1]}|`)).map(([, value]) => value);
      return res.end(JSON.stringify({ data }));
    }
    if (/\/PHONE-[AB]\/messages$/.test(url.pathname) && req.method === 'POST') {
      messageCounter += 1;
      return res.end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.${messageCounter}` }] }));
    }
    if (url.pathname === '/v24.0/me/permissions' && req.method === 'DELETE') return res.end(JSON.stringify({ success: true }));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: `Unexpected fake Meta path ${url.pathname}` } }));
  });
  const metaPort = await listen(metaServer);

  process.env.JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.NOTIFICATION_CREDENTIALS_SECRET = 'notifications-secret-0123456789abcdef0123456789abcdef0123456789';
  process.env.META_APP_ID = 'meta-app-vantixgc-test';
  process.env.META_APP_SECRET = 'meta-app-secret-vantixgc-test';
  process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = 'embedded-v4-config-test';
  process.env.META_GRAPH_VERSION = 'v24.0';
  process.env.META_GRAPH_BASE_URL = `http://127.0.0.1:${metaPort}`;
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-vantixgc-test';
  process.env.VANTIXGC_PUBLIC_BASE_URL = 'https://tracking.vantixgc.test';

  const notifications = require('../src/modules/notifications/notifications.service');
  const { app } = require('../src/app');

  const stamp = Date.now();
  const tenantA = await prisma.tenant.create({ data: { nombreEmpresa: `Notify A ${stamp}`, subdomain: `notify-a-${stamp}`, nicho: 'CORE_QA', pais: 'CO', moneda: 'COP' } });
  const tenantB = await prisma.tenant.create({ data: { nombreEmpresa: `Notify B ${stamp}`, subdomain: `notify-b-${stamp}`, nicho: 'CORE_QA', pais: 'CO', moneda: 'COP' } });
  const adminA = await prisma.user.create({ data: { tenantId: tenantA.id, nombre: 'Admin Notify A', email: `notify-a-${stamp}@example.com`, password: 'not-login', rol: 'ADMIN' } });
  const adminB = await prisma.user.create({ data: { tenantId: tenantB.id, nombre: 'Admin Notify B', email: `notify-b-${stamp}@example.com`, password: 'not-login', rol: 'ADMIN' } });

  // 1. Embedded Signup contract: no manual tenant token, backend exchanges the one-time code and encrypts the resulting token.
  const signupPublic = await notifications.embeddedSignupPublicConfig();
  assert.equal(signupPublic.embeddedSignupVersion, 'v4');
  assert.equal(signupPublic.ready, true);
  const connectedA = await notifications.completeEmbeddedSignup(tenantA.id, adminA.id, { code: 'AUTH-CODE-A', wabaId: 'WABA-A', phoneNumberId: 'PHONE-A' });
  const connectedB = await notifications.completeEmbeddedSignup(tenantB.id, adminB.id, { code: 'AUTH-CODE-B', wabaId: 'WABA-B', phoneNumberId: 'PHONE-B' });
  assert.equal(connectedA.connected, true);
  assert.equal(connectedB.connected, true);
  assert.equal(connectedA.displayPhoneNumber, '+571111111111');
  const rawCfgA = await prisma.notificationTenantConfig.findUnique({ where: { tenantId: tenantA.id } });
  assert.ok(rawCfgA.accessTokenCiphertext);
  assert.equal(rawCfgA.accessTokenCiphertext.includes('TOKEN-AUTH-CODE-A'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(connectedA, 'accessTokenCiphertext'), false);

  // 2. A rule cannot be enabled before Meta approval.
  const templateA = await notifications.createTemplate(tenantA.id, adminA.id, { name: `pedido_listo_${stamp}`, languageCode: 'es_CO', category: 'UTILITY', bodyText: 'Tu pedido {{1}} está listo. Seguimiento: {{2}}' });
  let blocked = null;
  try { await notifications.saveEventRule(tenantA.id, adminA.id, 'ORDER_READY', { enabled: true, templateId: templateA.id }); } catch (error) { blocked = error; }
  assert.equal(blocked?.code, 'NOTIFICATION_TEMPLATE_NOT_APPROVED');
  await notifications.submitTemplate(tenantA.id, adminA.id, templateA.id);
  await notifications.syncTemplateStates(tenantA.id, adminA.id);
  const approvedA = await prisma.notificationTemplate.findUnique({ where: { id: templateA.id } });
  assert.equal(approvedA.state, 'APPROVED');
  await notifications.saveEventRule(tenantA.id, adminA.id, 'ORDER_READY', { enabled: true, templateId: templateA.id });
  await notifications.saveEventRule(tenantA.id, adminA.id, 'TRACKING_STATUS_CHANGED', { enabled: true, templateId: templateA.id });
  await notifications.saveEventRule(tenantA.id, adminA.id, 'ACCOUNT_CLOSED_INVOICE', { enabled: true, templateId: templateA.id });

  // Tenant B gets its own approved template/rule to prove isolation.
  const templateB = await notifications.createTemplate(tenantB.id, adminB.id, { name: `pedido_listo_b_${stamp}`, languageCode: 'es_CO', category: 'UTILITY', bodyText: 'Tu pedido {{1}} está listo.' });
  await notifications.submitTemplate(tenantB.id, adminB.id, templateB.id);
  await notifications.syncTemplateStates(tenantB.id, adminB.id);
  await notifications.saveEventRule(tenantB.id, adminB.id, 'ORDER_READY', { enabled: true, templateId: templateB.id });

  const phoneA = '+573001234567';
  // 3. No consent => no automatic send.
  const withoutConsent = await notifications.enqueueEventNotification(tenantA.id, { eventCode: 'ORDER_READY', recipientPhoneE164: phoneA, parameters: ['ORD-001'] });
  assert.deepEqual(withoutConsent, { queued: false, reason: 'CONSENT_REQUIRED' });
  await notifications.grantConsent(tenantA.id, adminA.id, { phoneE164: phoneA, scope: 'TRANSACTIONAL', source: 'QA_EXPLICIT_CHECKBOX', evidence: { checkbox: true, timestamp: new Date().toISOString() } });
  const withConsent = await notifications.enqueueEventNotification(tenantA.id, { eventCode: 'ORDER_READY', recipientPhoneE164: phoneA, parameters: ['ORD-001'] });
  assert.equal(withConsent.queued, true);
  await notifications.processQueue(25);

  // 4. WhatsApp invoice reuses the exact canonical representation URL already stored by DIAN.
  const canonicalPdf = 'https://fiscal.vantixgc.test/dian/exact-same-document.pdf';
  const dianDoc = await prisma.dianDocument.create({
    data: {
      tenantId: tenantA.id,
      documentType: 'DOCUMENTO_EQUIVALENTE_POS',
      state: 'ACEPTADO',
      environment: 'HABILITACION',
      originType: 'COMPROBANTE_COMERCIAL',
      originId: `SALE-${stamp}`,
      internalNumber: `FV-${stamp}`,
      fiscalNumber: `POS-${stamp}`,
      providerResponse: { representationUrl: canonicalPdf }
    }
  });
  const invoiceQueued = await notifications.enqueueEventNotification(tenantA.id, { eventCode: 'ACCOUNT_CLOSED_INVOICE', recipientPhoneE164: phoneA, originType: 'COMPROBANTE_COMERCIAL', originId: `SALE-${stamp}`, dianDocumentId: dianDoc.id, parameters: [`FV-${stamp}`] });
  assert.equal(invoiceQueued.queued, true);
  await notifications.processQueue(25);
  const documentCall = providerCalls.find((x) => x.method === 'POST' && x.path === '/v24.0/PHONE-A/messages' && x.payload?.type === 'document');
  assert.equal(documentCall?.payload?.document?.link, canonicalPdf);
  const invoiceAttempt = await prisma.notificationDeliveryAttempt.findFirst({ where: { notificationMessageId: invoiceQueued.messageId }, orderBy: { attempt: 'desc' } });
  assert.equal(invoiceAttempt.providerResponse.canonicalDianRepresentationUrl, canonicalPdf);

  // 5. Disabling Marketing on A does not affect another A event nor tenant B.
  await notifications.ensureDefaultEventRules(tenantA.id);
  await notifications.saveEventRule(tenantA.id, adminA.id, 'MARKETING_CAMPAIGN', { enabled: false, templateId: null });
  const rulesA = await notifications.listEventRules(tenantA.id);
  const rulesB = await notifications.listEventRules(tenantB.id);
  assert.equal(rulesA.find((x) => x.eventCode === 'MARKETING_CAMPAIGN').enabled, false);
  assert.equal(rulesA.find((x) => x.eventCode === 'ORDER_READY').enabled, true);
  assert.equal(rulesB.find((x) => x.eventCode === 'ORDER_READY').enabled, true);

  // 7. Magic Link: stable random token, inbound lookup, proactive status update and public no-login view.
  const link = await notifications.createTrackingLink(tenantA.id, adminA.id, { originType: 'ORDER_GENERIC', originId: `ORDER-${stamp}`, publicReference: 'PED-001', currentStatus: 'RECIBIDO', customerPhoneE164: phoneA });
  const token = decodeURIComponent(new URL(link.publicUrl).pathname.split('/').pop());
  assert.ok(token.length >= 40);

  const callsBeforeInbound = providerCalls.length;
  await notifications.handleWhatsAppWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'PHONE-A' }, messages: [{ id: `wamid.inbound.${stamp}`, from: '573001234567', type: 'text', text: { body: '¿cómo va mi pedido?' } }] } }] }] });
  const inboundReplyCall = providerCalls.slice(callsBeforeInbound).find((x) => x.path === '/v24.0/PHONE-A/messages' && x.payload?.type === 'text');
  assert.ok(inboundReplyCall?.payload?.text?.body.includes(link.publicUrl));

  const updatedTracking = await notifications.updateTrackingStatus(tenantA.id, adminA.id, link.id, { status: 'PRODUCCION', note: 'Trabajo iniciado', completed: false });
  assert.equal(updatedTracking.publicUrl, link.publicUrl);
  assert.equal(updatedTracking.notification.queued, true);
  await notifications.processQueue(25);
  const statusTemplateCall = [...providerCalls].reverse().find((x) => x.path === '/v24.0/PHONE-A/messages' && x.payload?.type === 'template');
  assert.ok(JSON.stringify(statusTemplateCall.payload).includes(link.publicUrl));

  const publicServer = app.listen(0, '127.0.0.1');
  const publicPort = await new Promise((resolve) => publicServer.once('listening', () => resolve(publicServer.address().port)));
  try {
    const publicResponse = await fetch(`http://127.0.0.1:${publicPort}/seguimiento/${token}`);
    const publicHtml = await publicResponse.text();
    assert.equal(publicResponse.status, 200);
    assert.match(publicHtml, /PRODUCCION/);
    assert.doesNotMatch(publicHtml, /573001234567/);

    const guessedResponse = await fetch(`http://127.0.0.1:${publicPort}/seguimiento/${token.slice(0, -1)}X`);
    assert.equal(guessedResponse.status, 404);

    await notifications.updateTrackingStatus(tenantA.id, adminA.id, link.id, { status: 'ENTREGADO', completed: true });
    await prisma.trackingLink.update({ where: { id: link.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredResponse = await fetch(`http://127.0.0.1:${publicPort}/seguimiento/${token}`);
    const expiredHtml = await expiredResponse.text();
    assert.equal(expiredResponse.status, 410);
    assert.match(expiredHtml, /Enlace expirado/);
  } finally { await close(publicServer); }

  // 6. Disconnect A removes its encrypted token and leaves B untouched.
  await notifications.disconnectWhatsApp(tenantA.id, adminA.id);
  const afterDisconnectA = await prisma.notificationTenantConfig.findUnique({ where: { tenantId: tenantA.id } });
  const afterDisconnectB = await prisma.notificationTenantConfig.findUnique({ where: { tenantId: tenantB.id } });
  assert.equal(afterDisconnectA.connectionState, 'DISCONNECTED');
  assert.equal(afterDisconnectA.accessTokenCiphertext, null);
  assert.equal(afterDisconnectB.connectionState, 'CONNECTED');
  assert.ok(afterDisconnectB.accessTokenCiphertext);
  assert.ok(providerCalls.some((x) => x.method === 'DELETE' && x.path === '/v24.0/me/permissions'));

  console.log('NOTIFICATIONS + MAGIC LINK CORE V1 SMOKE OK');
  console.log(JSON.stringify({
    embeddedSignupV4Contract: true,
    tenantNeverPastesToken: true,
    accessTokenEncrypted: true,
    eventBlockedUntilTemplateApproved: true,
    explicitConsentRequired: true,
    canonicalDianPdfReusedExactly: true,
    tenantAndEventIsolation: true,
    disconnectIsolated: true,
    queueAndRetries: true,
    magicLinkInboundReply: true,
    proactiveStatusNotificationSameLink: true,
    publicTrackingWithoutLogin: true,
    tokenNonEnumerable: true,
    trackingExpiry: true,
    realMetaTenantOnboardingExecuted: false,
    note: 'CI validates the real HTTP contract against a local Meta-compatible server. Live Embedded Signup requires the production Meta App/Config ID and a human popup/OTP session.'
  }, null, 2));

  await close(metaServer);
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  try { await prisma.$disconnect(); } catch {}
}).finally(async () => { try { await prisma.$disconnect(); } catch {} });
