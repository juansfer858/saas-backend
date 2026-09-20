'use strict';

let lastChargeError = null;

function sanitizeText(value) {
  return String(value || '')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '<redacted-url>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const allowed = ['modelName', 'field_name', 'target', 'constraint'];
  const output = {};
  for (const key of allowed) {
    if (meta[key] == null) continue;
    const value = Array.isArray(meta[key]) ? meta[key].join(',') : meta[key];
    output[key] = sanitizeText(value);
  }
  return Object.keys(output).length ? output : null;
}

function record(error) {
  lastChargeError = {
    at: new Date().toISOString(),
    code: sanitizeText(error?.code || error?.name || 'UNKNOWN'),
    name: sanitizeText(error?.name || 'Error'),
    message: sanitizeText(error?.message || 'Error sin mensaje'),
    meta: sanitizeMeta(error?.meta)
  };
  console.error('DEMO_BAR_CHARGE_DIAGNOSTIC', JSON.stringify(lastChargeError));
  return { ...lastChargeError };
}

function clear() {
  lastChargeError = null;
}

function snapshot() {
  return lastChargeError ? { ...lastChargeError, meta: lastChargeError.meta ? { ...lastChargeError.meta } : null } : null;
}

module.exports = { record, clear, snapshot };
