'use strict';

const crypto = require('node:crypto');
const { canonicalize } = require('./offline-license');

const MANIFEST_VERSION = 1;
const ALLOWED_CHANNELS = new Set(['PILOT', 'STABLE', 'EMERGENCY']);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function verifyManifest({ envelope, publicKeyPem, expectedProduct = 'VantixGC Restaurantes' }) {
  if (!envelope || typeof envelope !== 'object') throw new Error('P13_UPDATE_ENVELOPE_INVALID');
  const manifest = envelope.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('P13_UPDATE_MANIFEST_INVALID');
  if (Number(manifest.manifestVersion) !== MANIFEST_VERSION) throw new Error('P13_UPDATE_MANIFEST_VERSION_UNSUPPORTED');
  for (const field of ['product', 'version', 'channel', 'sha256', 'packageFile', 'publishedAt', 'keyId']) {
    if (!String(manifest[field] || '').trim()) throw new Error(`P13_UPDATE_FIELD_REQUIRED:${field}`);
  }
  if (manifest.product !== expectedProduct) throw new Error('P13_UPDATE_PRODUCT_MISMATCH');
  if (!ALLOWED_CHANNELS.has(String(manifest.channel).toUpperCase())) throw new Error('P13_UPDATE_CHANNEL_INVALID');
  if (!/^[a-f0-9]{64}$/i.test(String(manifest.sha256))) throw new Error('P13_UPDATE_SHA256_INVALID');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(manifest.version))) throw new Error('P13_UPDATE_VERSION_INVALID');
  if (!Number.isFinite(Date.parse(String(manifest.publishedAt)))) throw new Error('P13_UPDATE_PUBLISHED_AT_INVALID');
  if (!String(publicKeyPem || '').trim()) throw new Error('P13_UPDATE_PUBLIC_KEY_MISSING');

  const signature = Buffer.from(String(envelope.signature || ''), 'base64url');
  if (!signature.length) throw new Error('P13_UPDATE_SIGNATURE_MISSING');
  const serialized = Buffer.from(canonicalize(manifest), 'utf8');
  if (!crypto.verify(null, serialized, publicKeyPem, signature)) throw new Error('P13_UPDATE_SIGNATURE_INVALID');

  return Object.freeze({ ok: true, manifest: Object.freeze({ ...manifest, channel: String(manifest.channel).toUpperCase() }) });
}

function verifyPackageBytes({ bytes, manifest }) {
  if (!Buffer.isBuffer(bytes)) throw new Error('P13_UPDATE_PACKAGE_BYTES_REQUIRED');
  const actual = sha256(bytes);
  if (actual.toLowerCase() !== String(manifest?.sha256 || '').toLowerCase()) {
    throw new Error(`P13_UPDATE_PACKAGE_HASH_MISMATCH:${actual}`);
  }
  return Object.freeze({ ok: true, sha256: actual, bytes: bytes.length });
}

function rolloutAllowed({ manifest, installedChannel }) {
  const target = String(manifest?.channel || '').toUpperCase();
  const current = String(installedChannel || '').toUpperCase();
  if (target === 'EMERGENCY') return true;
  if (current === 'PILOT') return target === 'PILOT' || target === 'STABLE';
  return target === 'STABLE';
}

module.exports = {
  MANIFEST_VERSION,
  sha256,
  verifyManifest,
  verifyPackageBytes,
  rolloutAllowed
};
