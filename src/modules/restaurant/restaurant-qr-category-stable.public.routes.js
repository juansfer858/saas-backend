'use strict';

const MARKER = 'VANTIX_RESTAURANT_QR_CATEGORY_STABLE_V1';

function patchQrCategoryStableRuntime(source) {
  let out = String(source || '');
  if (!out || out.includes(MARKER)) return out;
  const needles = [
    "      window.scrollTo({ top:0, behavior:'smooth' });",
    "      window.scrollTo({ top: 0, behavior: 'smooth' });"
  ];
  const needle = needles.find((candidate) => out.includes(candidate));
  if (!needle) throw new Error('RESTAURANT_QR_CATEGORY_SCROLL_TARGET_NOT_FOUND');
  return `/* ${MARKER} */\n${out.replace(needle, "      // Mantener la posición del cliente al cambiar de categoría.")}`;
}

function installQrCategoryStableRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-qr-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const patched = patchQrCategoryStableRuntime(source);
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      res.set('X-VantixGC-QR-Category-Stable', 'v1-no-scroll');
    }
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, patchQrCategoryStableRuntime, installQrCategoryStableRuntime };
