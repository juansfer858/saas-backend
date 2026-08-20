const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('src/web/notifications-config.js', 'utf8');
const app = fs.readFileSync('src/app.js', 'utf8');
const routes = fs.readFileSync('src/modules/notifications/notifications.routes.js', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/notifications/notifications.public.routes.js', 'utf8');
const provider = fs.readFileSync('src/modules/notifications/providers/meta-cloud.provider.js', 'utf8');

assert.match(ui, /Notificaciones/);
assert.match(ui, /Conectar mi WhatsApp Business/);
assert.match(ui, /WA_EMBEDDED_SIGNUP/);
assert.match(ui, /config_id/);
assert.match(ui, /response_type:\s*'code'/);
assert.match(ui, /override_default_response_type:\s*true/);
assert.match(ui, /whatsapp_embedded_signup/);
assert.match(ui, /Tu WhatsApp Business ya está conectado/);
assert.match(ui, /Desconectar/);
assert.match(ui, /Conectar otro número/);
assert.match(ui, /Plantillas Meta/);
assert.match(ui, /Consentimiento/);
assert.match(ui, /Magic Links de seguimiento/);
assert.match(ui, /Un evento no se puede activar sin plantilla aprobada/);
assert.doesNotMatch(ui, /pegar tu api key/i);
assert.doesNotMatch(ui, /accessTokenCiphertext/);
assert.doesNotMatch(ui, /wabaId.*input/i);

assert.match(app, /notifications-config\.js/);
assert.match(app, /webhooks\/whatsapp/);
assert.match(app, /trackingPublicPath/);
assert.match(routes, /embedded-signup\/complete/);
assert.match(routes, /plantillas\/sincronizar/);
assert.match(routes, /consentimientos/);
assert.match(routes, /seguimiento/);
assert.match(publicRoutes, /x-hub-signature-256/);
assert.match(publicRoutes, /Enlace expirado/);
assert.match(provider, /embeddedSignupVersion:\s*'v4'/);
assert.match(provider, /subscribed_apps/);
assert.match(provider, /message_templates/);
assert.match(provider, /\/messages/);

console.log('NOTIFICATIONS UI + EMBEDDED SIGNUP CONTRACT SMOKE OK');
console.log(JSON.stringify({
  fifthAdvancedConfigBlock: true,
  embeddedSignupV4Button: true,
  noManualTenantTokens: true,
  templateApprovalUi: true,
  eventGatingUi: true,
  consentUi: true,
  magicLinkUi: true,
  signedWebhookSurface: true
}, null, 2));
