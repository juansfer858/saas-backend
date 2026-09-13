'use strict';

const crypto = require('node:crypto');

function normalizePublicKey(publicKey) {
  return crypto.createPublicKey(publicKey);
}

function publicKeyFingerprint(publicKey) {
  const key = normalizePublicKey(publicKey);
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

function verifyInstallationProof({ publicKey, challenge, signature }) {
  if (!challenge) throw new Error('P13_INSTALLATION_CHALLENGE_REQUIRED');
  const signatureBytes = Buffer.isBuffer(signature) ? signature : Buffer.from(String(signature || ''), 'base64url');
  if (!signatureBytes.length) throw new Error('P13_INSTALLATION_SIGNATURE_REQUIRED');
  return crypto.verify(null, Buffer.from(String(challenge), 'utf8'), normalizePublicKey(publicKey), signatureBytes);
}

// LAB ONLY. En Windows productivo la clave privada no debe exportarse a texto:
// se protegerá con TPM cuando exista y DPAPI como fallback. Esta función permite
// probar el contrato criptográfico sin introducir todavía almacenamiento Windows.
function createLabInstallationIdentity({ installationId = crypto.randomUUID() } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  return Object.freeze({
    installationId,
    publicKeyPem,
    fingerprint,
    signChallenge(challenge) {
      if (!challenge) throw new Error('P13_INSTALLATION_CHALLENGE_REQUIRED');
      return crypto.sign(null, Buffer.from(String(challenge), 'utf8'), privateKey).toString('base64url');
    }
  });
}

module.exports = {
  publicKeyFingerprint,
  verifyInstallationProof,
  createLabInstallationIdentity
};
