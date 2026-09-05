'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../../../config/prisma');

const MANIFEST_PATH = path.resolve(__dirname, '../../../../public/edge-releases/manifest.json');
const ARTIFACT_ROOT = path.dirname(MANIFEST_PATH);
const CHANNELS = new Set(['PILOT', 'STABLE']);
const SHA256_RE = /^[a-f0-9]{64}$/;

function fallbackArtifactUrl(version, file) {
  const repository = String(process.env.EDGE_RELEASE_GITHUB_REPOSITORY || 'juansfer858/saas-backend').trim();
  const tag = `edge-v${version}`;
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
}

function readBundledManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw);
  return manifest && typeof manifest === 'object' && manifest.releases && typeof manifest.releases === 'object'
    ? manifest
    : { schema: 'invalid', releases: {} };
}

function normalizeBundledRelease(version, value) {
  const normalizedVersion = String(version || '').trim();
  const row = value && typeof value === 'object' ? value : {};
  const channel = String(row.channel || '').trim().toUpperCase();
  const file = String(row.file || '').trim();
  const sha256 = String(row.sha256 || '').trim().toLowerCase();
  if (!/^[0-9A-Za-z._-]+$/.test(normalizedVersion)) return null;
  if (!CHANNELS.has(channel) || !SHA256_RE.test(sha256)) return null;
  if (file !== `vantixgc-edge-${normalizedVersion}.zip`) return null;
  const artifactPath = path.join(ARTIFACT_ROOT, file);
  if (!fs.existsSync(artifactPath)) return null;
  return { version: normalizedVersion, channel, file, sha256, artifactPath };
}

async function ensureBundledGlobalReleases(client = prisma) {
  const manifest = readBundledManifest();
  const summary = { created: [], existing: [], conflicts: [], skipped: [] };
  const entries = Object.entries(manifest.releases || {}).sort(([a], [b]) => a.localeCompare(b));

  for (const [version, value] of entries) {
    const bundled = normalizeBundledRelease(version, value);
    if (!bundled) {
      summary.skipped.push(String(version));
      continue;
    }

    const existing = await client.edgeRelease.findFirst({ where: { tenantId: null, version: bundled.version } });
    if (existing) {
      const same = String(existing.channel || '').toUpperCase() === bundled.channel
        && String(existing.sha256 || '').toLowerCase() === bundled.sha256;
      if (same) summary.existing.push(bundled.version);
      else summary.conflicts.push({ version: bundled.version, releaseId: existing.id });
      continue;
    }

    try {
      const created = await client.edgeRelease.create({
        data: {
          tenantId: null,
          version: bundled.version,
          channel: bundled.channel,
          artifactUrl: fallbackArtifactUrl(bundled.version, bundled.file),
          sha256: bundled.sha256,
          releaseNotes: `AUTO_BUNDLED_CORE · Artifact Edge validado y empaquetado en Core (${bundled.file})`,
          mandatory: false,
          enabled: true,
          createdByUserId: null
        }
      });
      summary.created.push({ version: bundled.version, releaseId: created.id });
    } catch (error) {
      if (error?.code === 'P2002') {
        summary.existing.push(bundled.version);
        continue;
      }
      throw error;
    }
  }

  return summary;
}

module.exports = {
  MANIFEST_PATH,
  ARTIFACT_ROOT,
  fallbackArtifactUrl,
  readBundledManifest,
  normalizeBundledRelease,
  ensureBundledGlobalReleases
};
