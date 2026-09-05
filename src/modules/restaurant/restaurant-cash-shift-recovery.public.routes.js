'use strict';

const CASH_SHIFT_RECOVERY_MARKER = 'VANTIX_CASH_SHIFT_SERVER_RECOVERY_V1';

function patchCashShiftRecovery(source) {
  if (!source || source.includes(CASH_SHIFT_RECOVERY_MARKER)) return source;
  const needle = "    const cajas = await api('/api/v1/tesoreria/cajas-bancos');\n    let summary = null;";
  if (!source.includes(needle)) return source;

  const replacement = `    const cajas = await api('/api/v1/tesoreria/cajas-bancos');
    // ${CASH_SHIFT_RECOVERY_MARKER}: PostgreSQL/Core es la fuente de verdad del turno.
    try {
      const cashState = await api('/api/v1/restaurante/caja/turno-activo');
      const serverShiftId = cashState?.ownShift?.id || null;
      if (serverShiftId) {
        if (S.cashShiftId !== serverShiftId) S.cashMetric = null;
        S.cashShiftId = serverShiftId;
        localStorage.setItem(SHIFT_KEY, serverShiftId);
      } else {
        S.cashShiftId = null;
        S.cashMetric = null;
        localStorage.removeItem(SHIFT_KEY);
      }
    } catch {}
    let summary = null;`;

  return source.replace(needle, replacement);
}

function installCashShiftRecoveryRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const patched = patchCashShiftRecovery(source);
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Cash-Shift-Recovery', 'core-source-v1');
    return originalSend(body);
  };
  return next();
}

module.exports = {
  CASH_SHIFT_RECOVERY_MARKER,
  patchCashShiftRecovery,
  installCashShiftRecoveryRuntime
};
