const jwt = require('jsonwebtoken');

const JWT_ISSUER = 'saas-core';
const JWT_AUDIENCE = 'saas-core-api';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
  }

  return secret;
}

function signAccessToken({ userId, tenantId, rol, deviceId = null, authType = null, expiresIn = null }) {
  const payload = { userId, tenantId, rol };
  if (deviceId) payload.deviceId = deviceId;
  if (authType) payload.authType = authType;
  return jwt.sign(
    payload,
    getJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '8h',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  });
}

module.exports = {
  signAccessToken,
  verifyAccessToken
};
