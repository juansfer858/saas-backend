'use strict';

const crypto = require('node:crypto');

const LICENSE_VERSION = 1;
const ALLOWED_STATES = Object.freeze(['VALID', 'GRACE', 'EXPIRED']);

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function parseInstant(value, field) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) throw new Error(`P13_LICENSE_INVALID_${field.toUpperCase()}`);
  return ms;
}

function decodeSignature(signature) {
  const text = String(signature || '').trim();
  if (!text) throw new Error('P13_LICENSE_SIGNATURE_MISSING');
  const bytes = Buffer.from(text, 'base64url');
  if (!bytes.length) throw new Error('P13_LICENSE_SIGNATURE_INVALID_ENCODING');
  return bytes;
}

function assertPayloadShape(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('P13_LICENSE_PAYLOAD_INVALID');
  }
  if (Number(payload.licenseVersion) !== LICENSE_VERSION) {
    throw new Error(`P13_LICENSE_VERSION_UNSUPPORTED:${payload.licenseVersion}`);
  }
  for (const field of ['tenantId', 'tenantSubdomain', 'installationId', 'installationPublicKeySha256', 'plan', 'issuedAt', 'validUntil', 'graceUntil', 'keyId']) {
    if (!String(payload[field] || '').trim()) throw new Error(`P13_LICENSE_FIELD_REQUIRED:${field}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(String(payload.installationPublicKeySha256))) {
    throw new Error('P13_LICENSE_INSTALLATION_KEY_FINGERPRINT_INVALID');
  }
  if (!payload.features || typeof payload.features !== 'object' || Array.isArray(payload.features)) {
    throw new Error('P13_LICENSE_FEATURES_INVALID');
  }
  return payload;
}

function licenseState(payload, now = Date.now()) {
  const validUntil = parseInstant(payload.validUntil, 'validUntil');
  const graceUntil = parseInstant(payload.graceUntil, 'graceUntil');
  if (graceUntil < validUntil) throw new Error('P13_LICENSE_GRACE_BEFORE_VALID_UNTIL');
  if (now <= validUntil) return 'VALID';
  if (now <= graceUntil) return 'GRACE';
  return 'EXPIRED';
}

function verifySignedLicense({ envelope, publicKeyPem, expectedTenantId, expectedTenantSubdomain, expectedInstallationId, expectedInstallationPublicKeySha256, now = Date.now(), maxFutureClockSkewMs = 5 * 60 * 1000 }) {
  if (!envelope || typeof envelope !== 'object') throw new Error('P13_LICENSE_ENVELOPE_INVALID');
  const payload = assertPayloadShape(envelope.payload);
  if (!String(publicKeyPem || '').trim()) throw new Error('P13_LICENSE_PUBLIC_KEY_MISSING');

  const serialized = Buffer.from(canonicalize(payload), 'utf8');
  const signature = decodeSignature(envelope.signature);
  const validSignature = crypto.verify(null, serialized, publicKeyPem, signature);
  if (!validSignature) throw new Error('P13_LICENSE_SIGNATURE_INVALID');

  if (expectedTenantId && payload.tenantId !== expectedTenantId) throw new Error('P13_LICENSE_TENANT_ID_MISMATCH');
  if (expectedTenantSubdomain && payload.tenantSubdomain !== expectedTenantSubdomain) throw new Error('P13_LICENSE_TENANT_SUBDOMAIN_MISMATCH');
  if (expectedInstallationId && payload.installationId !== expectedInstallationId) throw new Error('P13_LICENSE_INSTALLATION_MISMATCH');
  if (expectedInstallationPublicKeySha256 && String(payload.installationPublicKeySha256).toLowerCase() !== String(expectedInstallationPublicKeySha256).toLowerCase()) {
    throw new Error('P13_LICENSE_INSTALLATION_KEY_MISMATCH');
  }

  const issuedAt = parseInstant(payload.issuedAt, 'issuedAt');
  if (issuedAt > now + maxFutureClockSkewMs) throw new Error('P13_LICENSE_ISSUED_IN_FUTURE');

  const state = licenseState(payload, now);
  if (!ALLOWED_STATES.includes(state)) throw new Error('P13_LICENSE_STATE_INVALID');

  return Object.freeze({
    ok: true,
    state,
    payload: Object.freeze({ ...payload, features: Object.freeze({ ...payload.features }) }),
    lease: Object.freeze({
      issuedAt: new Date(issuedAt).toISOString(),
      validUntil: new Date(parseInstant(payload.validUntil, 'validUntil')).toISOString(),
      graceUntil: new Date(parseInstant(payload.graceUntil, 'graceUntil')).toISOString()
    })
  });
}

function isFeatureEnabled(verifiedLicense, feature) {
  if (!verifiedLicense?.ok) return false;
  return verifiedLicense.payload.features?.[feature] === true;
}

module.exports = {
  LICENSE_VERSION,
  canonicalize,
  licenseState,
  verifySignedLicense,
  isFeatureEnabled
};
