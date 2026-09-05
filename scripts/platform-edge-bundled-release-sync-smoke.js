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
assert.match(String(current.sha256 || ''), /^[a-f0-9]{64}$/);
assert.ok(fs.existsSync(`public/edge-releases/${current.file}`));
assert.match(sync.fallbackArtifactUrl(version.version, current.file), /github\.com\/juansfer858\/saas-backend\/releases\/download/);

const rows = new Map();
let creates = 0;
const client = {
  edgeRelease: {
    findFirst: async ({ where }) => rows.get(where.version) || null,
    create: async ({ data }) => {
      creates += 1;
      const row = { id: `release-${creates}`, ...data };
      rows.set(data.version, row);
      return row;
    }
  }
};

(async () => {
  const first = await sync.ensureBundledGlobalReleases(client);
  assert.ok(first.created.some((row) => row.version === version.version));
  assert.equal(first.conflicts.length, 0);
  assert.equal(creates, Object.keys(manifest.releases).length);

  const second = await sync.ensureBundledGlobalReleases(client);
  assert.equal(second.created.length, 0, 'second sync must be idempotent');
  assert.ok(second.existing.includes(version.version));
  assert.equal(creates, Object.keys(manifest.releases).length);

  const currentRow = rows.get(version.version);
  rows.set(version.version, { ...currentRow, sha256: '0'.repeat(64) });
  const conflict = await sync.ensureBundledGlobalReleases(client);
  assert.ok(conflict.conflicts.some((row) => row.version === version.version));
  assert.equal(rows.get(version.version).sha256, '0'.repeat(64), 'conflicting DB release must never be overwritten');

  const publicRoute = fs.readFileSync('src/modules/platform/saas/platform-edge-rollout.public.routes.js', 'utf8');
  assert.match(publicRoute, /ensureBundledGlobalReleases/);
  assert.match(publicRoute, /CENTRAL_ROLLOUT_V4_UPDATE_CHECK/);
  assert.match(publicRoute, /platform-edge-central-v4-update-check/);

  console.log('PLATFORM EDGE BUNDLED RELEASE SYNC V1 SMOKE OK', JSON.stringify({
    currentVersion: version.version,
    currentChannel: version.channel,
    createdOnFirstSync: first.created.length,
    idempotent: true,
    conflictSafe: true,
    autoRollout: false,
    platformUiContract: 'V4_PRESERVED'
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
