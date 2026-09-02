'use strict';

const {
  PAYMENT_METHODS_VISIBILITY_MARKER,
  paymentMethodsVisibilityRuntime
} = require('./restaurant-payment-methods-visibility.public.routes');

// The source runtime is authored inside String.raw so escaped backticks survive module parsing.
// Convert only those escaped delimiters before sending the browser asset.
const decodedPaymentMethodsVisibilityRuntime = paymentMethodsVisibilityRuntime.replaceAll('\\`', '`');

// Centro de control hydrates #userRole from S.context.user.rol after
// /api/v1/restaurante/ui-context. That live tenant context is authoritative for the
// current UI; the login-session role is only a bootstrap fallback while context loads.
const sessionFirstRoleResolver = "const currentRole=()=>String(session.user?.rol||$('#userRole')?.textContent||'').trim().toUpperCase();";
const contextFirstRoleResolver = "const currentRole=()=>String($('#userRole')?.textContent||session.user?.rol||'').trim().toUpperCase();";
if (!decodedPaymentMethodsVisibilityRuntime.includes(sessionFirstRoleResolver)) {
  throw new Error('PAYMENT_METHODS_VISIBILITY_ROLE_RESOLVER_NOT_FOUND');
}
const paymentMethodsVisibilityBrowserRuntime = decodedPaymentMethodsVisibilityRuntime
  .replace(sessionFirstRoleResolver, contextFirstRoleResolver)
  .replace("version:'2.1.0'", "version:'2.2.0'")
  .replace('eventDriven:true}', "eventDriven:true,contextRoleFirst:true}");

function installPaymentMethodsVisibilityRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(PAYMENT_METHODS_VISIBILITY_MARKER)) {
      const patched = `${source}\n;${paymentMethodsVisibilityBrowserRuntime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Payment-Methods-Visibility', 'v2-caja-header');
    return originalSend(body);
  };
  return next();
}

module.exports = {
  PAYMENT_METHODS_VISIBILITY_MARKER,
  paymentMethodsVisibilityBrowserRuntime,
  installPaymentMethodsVisibilityRuntime
};
