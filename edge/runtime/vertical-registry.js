'use strict';

const path = require('node:path');

const ADAPTERS = Object.freeze({
  RESTAURANT: Object.freeze({
    code: 'RESTAURANT',
    adapter: 'restaurant',
    localFirst: true,
    entry: path.join(__dirname, '..', 'agent', 'workspace-entry.js'),
    operationPrefixes: Object.freeze(['RESTAURANT_']),
    bootstrapEndpoint: '/edge/api/v1/restaurant/bootstrap',
    syncEndpoint: '/edge/api/v1/sync/restaurant-operations',
    snapshotKind: 'restaurant'
  })
});

function normalizeManifest(manifest) {
  const rows = Array.isArray(manifest?.verticals) ? manifest.verticals : [];
  return rows.map((row) => ({ ...row, code: String(row.code || '').toUpperCase() }));
}

function activeAdapters(manifest) {
  return normalizeManifest(manifest)
    .map((row) => ({ manifest: row, adapter: ADAPTERS[row.code] || null }))
    .filter((row) => row.adapter && row.manifest.localFirst !== false);
}

function primaryAdapter(manifest) {
  return activeAdapters(manifest)[0] || null;
}

function operationRoute(type, manifest) {
  const operationType = String(type || '').toUpperCase();
  for (const row of activeAdapters(manifest)) {
    if (row.adapter.operationPrefixes.some((prefix) => operationType.startsWith(prefix))) {
      return { verticalCode: row.adapter.code, endpoint: row.adapter.syncEndpoint };
    }
  }
  return { verticalCode: null, endpoint: '/edge/api/v1/sync/operations' };
}

module.exports = { ADAPTERS, normalizeManifest, activeAdapters, primaryAdapter, operationRoute };
