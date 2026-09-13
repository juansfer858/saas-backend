'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  canonicalize,
  verifySignedLicense,
  isFeatureEnabled
} = require('../lab/restaurant-p13/security/offline-license');
const {
  sha256,
  verifyManifest,
  verifyPackageBytes,
  rolloutAllowed
} = require('../lab/restaurant-p13/security/update-manifest');

function sign(value, privateKey) {
  return crypto.sign(null, Buffer.from(canonicalize(value), 'utf8'), privateKey).toString('base64url');
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const now = Date.parse('2026-09-13T20:00:00.000Z');

const licensePayload = {
  licenseVersion: 1,
  tenantId: 'tenant-p13-demo',
  tenantSubdomain: 'demo-restaurante',
  installationId: 'installation-p13-001',
  plan: 'RESTAURANTE_PRO',
  features: {
    RESTAURANTE: true,
    DOMICILIOS: true,
    INVENTARIO: true,
    CONTABILIDAD: true,
    MULTISEDE: false
  },
  issuedAt: '2026-09-13T19:00:00.000Z',
  validUntil: '2026-10-13T19:00:00.000Z',
  graceUntil: '2026-10-28T19:00:00.000Z',
  keyId: 'vantix-license-lab-1'
};
const licenseEnvelope = { payload: licensePayload, signature: sign(licensePayload, privateKey) };
const verified = verifySignedLicense({
  envelope: licenseEnvelope,
  publicKeyPem,
  expectedTenantId: 'tenant-p13-demo',
  expectedTenantSubdomain: 'demo-restaurante',
  expectedInstallationId: 'installation-p13-001',
  now
});
assert.equal(verified.state, 'VALID');
assert.equal(isFeatureEnabled(verified, 'RESTAURANTE'), true);
assert.equal(isFeatureEnabled(verified, 'MULTISEDE'), false);

const grace = verifySignedLicense({
  envelope: licenseEnvelope,
  publicKeyPem,
  expectedInstallationId: 'installation-p13-001',
  now: Date.parse('2026-10-20T12:00:00.000Z')
});
assert.equal(grace.state, 'GRACE');

const expired = verifySignedLicense({
  envelope: licenseEnvelope,
  publicKeyPem,
  expectedInstallationId: 'installation-p13-001',
  now: Date.parse('2026-11-01T12:00:00.000Z')
});
assert.equal(expired.state, 'EXPIRED');

assert.throws(() => verifySignedLicense({
  envelope: licenseEnvelope,
  publicKeyPem,
  expectedInstallationId: 'cloned-installation',
  now
}), /INSTALLATION_MISMATCH/);

const tamperedLicense = {
  payload: { ...licensePayload, plan: 'RESTAURANTE_ENTERPRISE' },
  signature: licenseEnvelope.signature
};
assert.throws(() => verifySignedLicense({ envelope: tamperedLicense, publicKeyPem, now }), /SIGNATURE_INVALID/);

const packageBytes = Buffer.from('vantix-p13-release-payload-v1', 'utf8');
const manifest = {
  manifestVersion: 1,
  product: 'VantixGC Restaurantes',
  version: '3.0.0-p13.1',
  channel: 'PILOT',
  sha256: sha256(packageBytes),
  packageFile: 'vantixgc-restaurantes-3.0.0-p13.1.zip',
  publishedAt: '2026-09-13T19:30:00.000Z',
  keyId: 'vantix-release-lab-1'
};
const manifestEnvelope = { manifest, signature: sign(manifest, privateKey) };
const verifiedManifest = verifyManifest({ envelope: manifestEnvelope, publicKeyPem });
assert.equal(verifiedManifest.manifest.version, '3.0.0-p13.1');
assert.equal(verifyPackageBytes({ bytes: packageBytes, manifest: verifiedManifest.manifest }).ok, true);
assert.equal(rolloutAllowed({ manifest: verifiedManifest.manifest, installedChannel: 'PILOT' }), true);
assert.equal(rolloutAllowed({ manifest: verifiedManifest.manifest, installedChannel: 'STABLE' }), false);

const tamperedManifest = {
  manifest: { ...manifest, version: '9.9.9' },
  signature: manifestEnvelope.signature
};
assert.throws(() => verifyManifest({ envelope: tamperedManifest, publicKeyPem }), /SIGNATURE_INVALID/);
assert.throws(() => verifyPackageBytes({ bytes: Buffer.from('altered'), manifest }), /HASH_MISMATCH/);

console.log(JSON.stringify({
  ok: true,
  phase: 'P13-C-H-SECURITY-LAB',
  licenseSignature: 'ED25519_OK',
  installationBinding: 'OK',
  offlineStates: ['VALID', 'GRACE', 'EXPIRED'],
  featureEntitlements: 'OK',
  updateManifestSignature: 'ED25519_OK',
  packageSha256: 'OK',
  rolloutChannels: 'OK',
  productionTouched: false
}));
