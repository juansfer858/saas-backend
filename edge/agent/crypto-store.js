const crypto = require('node:crypto');

function deriveKey(secret) {
  if (!secret || String(secret).length < 24) throw new Error('EDGE_LOCAL_ENCRYPTION_KEY debe tener al menos 24 caracteres');
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encryptJson(value, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const clear = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

function decryptJson(encoded, secret) {
  const raw = Buffer.from(String(encoded), 'base64url');
  if (raw.length < 29) throw new Error('Payload local cifrado inválido');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

module.exports = { encryptJson, decryptJson, deriveKey };
