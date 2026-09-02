'use strict';

const {
  PAYMENT_METHODS_VISIBILITY_MARKER,
  paymentMethodsVisibilityRuntime
} = require('./restaurant-payment-methods-visibility.public.routes');

// The source runtime is authored inside String.raw so escaped backticks survive module parsing.
// Convert only those escaped delimiters before sending the browser asset.
const paymentMethodsVisibilityBrowserRuntime = paymentMethodsVisibilityRuntime.replaceAll('\\`', '`');

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
