'use strict';

const { AppError } = require('../../utils/app-error');

const PLATFORM_MANAGED = new Set([
  'POST /releases',
  'PATCH /agents/:id/release-channel',
  'POST /agents/:id/deploy'
]);

function normalizedRoute(req) {
  const method = String(req.method || '').toUpperCase();
  const path = String(req.path || '');
  if (method === 'POST' && path === '/releases') return 'POST /releases';
  if (method === 'PATCH' && /^\/agents\/[^/]+\/release-channel$/.test(path)) return 'PATCH /agents/:id/release-channel';
  if (method === 'POST' && /^\/agents\/[^/]+\/deploy$/.test(path)) return 'POST /agents/:id/deploy';
  return `${method} ${path}`;
}

function edgeTenantUpdateGuard(req, _res, next) {
  if (!PLATFORM_MANAGED.has(normalizedRoute(req))) return next();
  return next(new AppError(
    403,
    'Las actualizaciones Edge son administradas únicamente desde el Panel SaaS Master.',
    'EDGE_UPDATE_PLATFORM_MANAGED'
  ));
}

module.exports = { edgeTenantUpdateGuard, PLATFORM_MANAGED };
