'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const version = require('../edge/version.json');
const sync = require('../src/modules/platform/saas/platform-edge-bundled-release-sync.service');

const manifest = sync.readBundledManifest();
const current = manifest?.releases?.[version.version];
assert.ok(current, `Bundled manifest must contain ${version.version}`);
assert.equal(current.channel, version.channel);
assert.equal(String(manifest.fleetRolloutVersion || ''), '', 'fleet rollout automático debe permanecer desactivado');
assert.equal(manifest.installRecommended, version.version);
assert.match(String(current.sha256 || ''), /^[a-f0-9]{64}$/);
assert.ok(fs.existsSync(`public/edge-releases/${current.file}`));
assert.match(sync.fallbackArtifactUrl(version.version, current.file), /github\.com\/juansfer858\/saas-backend\/releases\/download/);

assert.ok(sync.compareEdgeVersions('2.1.15-offline-print.1', version.version) < 0);
assert.ok(sync.compareEdgeVersions('2.1.16-self-heal.3', version.version) < 0);
assert.equal(sync.compareEdgeVersions(version.version, version.version), 0);
assert.ok(sync.compareEdgeVersions('2.1.17-future.1', version.version) > 0);

const rows = new Map();
let creates = 0;
let updates = 0;
const client = {
  edgeRelease: {
    findFirst: async ({ where }) => rows.get(where.version) || null,
    create: async ({ data }) => {
      creates += 1;
      const row = { id: `release-${creates}`, ...data };
      rows.set(data.version, row);
      return row;
    },
    update: async ({ where, data }) => {
      updates += 1;
      const pair = [...rows.entries()].find(([, row]) => row.id === where.id);
      assert.ok(pair, `release ${where.id} must exist before update`);
      const [key, row] = pair;
      const next = { ...row, ...data };
      rows.set(key, next);
      return next;
    }
  }
};

(async () => {
  const first = await sync.ensureBundledGlobalReleases(client);
  assert.ok(first.created.some((row) => row.version === version.version));
  assert.equal(first.conflicts.length, 0);
  assert.equal(creates, Object.keys(manifest.releases).length);
  assert.equal(rows.get(version.version).mandatory, false, 'V95.4 manual repair must not become mandatory fleet rollout');

  const historicalVersion = Object.keys(manifest.releases).find((item) => item !== version.version);
  const historical = rows.get(historicalVersion);
  rows.set(historicalVersion, { ...historical, mandatory: true });

  const second = await sync.ensureBundledGlobalReleases(client);
  assert.equal(second.created.length, 0, 'second sync must be idempotent');
  assert.ok(second.existing.includes(version.version));
  assert.equal(creates, Object.keys(manifest.releases).length);
  assert.equal(rows.get(historicalVersion).mandatory, true, 'historical mandatory flags must never be cleared by sync');
  assert.equal(updates, 0, 'idempotent sync must not rewrite exact existing releases');

  const currentRow = rows.get(version.version);
  rows.set(version.version, { ...currentRow, sha256: '0'.repeat(64) });
  const conflict = await sync.ensureBundledGlobalReleases(client);
  assert.ok(conflict.conflicts.some((row) => row.version === version.version));
  assert.equal(rows.get(version.version).sha256, '0'.repeat(64), 'conflicting DB release must never be overwritten');

  const publicRoute = fs.readFileSync('src/modules/platform/saas/platform-edge-rollout.public.routes.js', 'utf8');
  const fleetSource = fs.readFileSync('src/modules/platform/saas/platform-edge-bundled-release-sync.service.js', 'utf8');
  assert.match(publicRoute, /ensureBundledGlobalReleases/);
  assert.match(publicRoute, /CENTRAL_ROLLOUT_V4_UPDATE_CHECK/);
  assert.match(publicRoute, /platform-edge-central-v4-update-check/);
  assert.match(fleetSource, /fleetRolloutVersion/);
  assert.match(fleetSource, /OFFLINE_WAIT/);
  assert.match(fleetSource, /NEWER_CURRENT/);
  assert.match(fleetSource, /ALREADY_PROTECTED/);
  assert.match(fleetSource, /NODE_ENV !== 'production'/);
  assert.match(fleetSource, /EDGE_FLEET_ROLLOUT_ENABLED === 'false'/);

  console.log('PLATFORM EDGE BUNDLED RELEASE + MANUAL REPAIR V95.4 SMOKE OK', JSON.stringify({
    currentVersion: version.version,
    currentChannel: version.channel,
    fleetRolloutVersion: null,
    installRecommended: manifest.installRecommended,
    createdOnFirstSync: first.created.length,
    idempotent: true,
    conflictSafe: true,
    historicalMandatoryPreserved: true,
    automaticFleetRollout: false,
    manualRepairFromDevices: true,
    futureVersionNoDowngrade: true,
    platformUiContract: 'V4_PRESERVED'
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
