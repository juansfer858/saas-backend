'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../../../config/prisma');

const MANIFEST_PATH = path.resolve(__dirname, '../../../../public/edge-releases/manifest.json');
const ARTIFACT_ROOT = path.dirname(MANIFEST_PATH);
const CHANNELS = new Set(['PILOT', 'STABLE']);
const SHA256_RE = /^[a-f0-9]{64}$/;
const ACTIVE_DEPLOYMENT_STATES = ['PENDING', 'DOWNLOADING', 'BACKUP', 'INSTALLING', 'HEALTHCHECK'];
const ONLINE_WINDOW_MS = 90000;
const FLEET_SWEEP_MS = 60000;

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

function versionParts(value) {
  const parts = String(value || '').match(/\d+/g);
  if (!parts || parts.length < 3) return null;
  return parts.slice(0, 4).map((x) => Number(x || 0));
}

function compareEdgeVersions(a, b) {
  const aa = versionParts(a);
  const bb = versionParts(b);
  if (!aa || !bb) return null;
  for (let i = 0; i < Math.max(aa.length, bb.length, 4); i += 1) {
    const left = aa[i] || 0;
    const right = bb[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

function isOnline(installation, now = Date.now()) {
  if (!installation?.lastHeartbeatAt) return false;
  return now - new Date(installation.lastHeartbeatAt).getTime() <= ONLINE_WINDOW_MS;
}

async function ensureBundledGlobalReleases(client = prisma) {
  const manifest = readBundledManifest();
  const fleetTarget = String(manifest.fleetRolloutVersion || '').trim();
  const summary = { created: [], existing: [], updated: [], conflicts: [], skipped: [] };
  const entries = Object.entries(manifest.releases || {}).sort(([a], [b]) => a.localeCompare(b));

  for (const [version, value] of entries) {
    const bundled = normalizeBundledRelease(version, value);
    if (!bundled) {
      summary.skipped.push(String(version));
      continue;
    }

    const existing = await client.edgeRelease.findFirst({ where: { tenantId: null, version: bundled.version } });
    if (existing) {
      const sameHash = String(existing.sha256 || '').toLowerCase() === bundled.sha256;
      if (!sameHash) {
        summary.conflicts.push({ version: bundled.version, releaseId: existing.id });
        continue;
      }
      const desiredMandatory = bundled.version === fleetTarget;
      if (String(existing.channel || '').toUpperCase() !== bundled.channel || Boolean(existing.mandatory) !== desiredMandatory || !existing.enabled) {
        await client.edgeRelease.update({
          where: { id: existing.id },
          data: { channel: bundled.channel, mandatory: desiredMandatory, enabled: true, artifactUrl: fallbackArtifactUrl(bundled.version, bundled.file) }
        });
        summary.updated.push(bundled.version);
      } else {
        summary.existing.push(bundled.version);
      }
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
          mandatory: bundled.version === fleetTarget,
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

async function ensureUpdateCheck(client, installation, deployment, now = new Date()) {
  const recentCutoff = new Date(now.getTime() - 10 * 60 * 1000);
  const recent = await client.edgeRelayRequest.findFirst({
    where: {
      edgeAgentId: installation.edgeAgentId,
      action: 'UPDATE_CHECK',
      creadoEn: { gte: recentCutoff }
    },
    orderBy: { creadoEn: 'desc' }
  });
  if (recent) return { status: 'CHECK_RECENT', requestId: recent.id };
  const request = await client.edgeRelayRequest.create({
    data: {
      tenantId: installation.tenantId,
      edgeAgentId: installation.edgeAgentId,
      action: 'UPDATE_CHECK',
      requestBody: { reason: 'FLEET_SELF_HEAL_V95_4', deploymentId: deployment.id, targetVersion: deployment.targetVersion },
      expiresAt: new Date(now.getTime() + 300000)
    }
  });
  return { status: 'CHECK_SCHEDULED', requestId: request.id };
}

async function scheduleFleetInstallation(client, release, installation, now = new Date()) {
  const current = String(installation.softwareVersion || '').trim();
  if (current === release.version) return { status: 'ALREADY_CURRENT', edgeAgentId: installation.edgeAgentId };
  const comparison = compareEdgeVersions(current, release.version);
  if (comparison != null && comparison > 0) return { status: 'NEWER_CURRENT', edgeAgentId: installation.edgeAgentId, current };
  if (!isOnline(installation, now.getTime())) return { status: 'OFFLINE_WAIT', edgeAgentId: installation.edgeAgentId };

  const active = await client.edgeDeployment.findFirst({
    where: { tenantId: installation.tenantId, edgeAgentId: installation.edgeAgentId, state: { in: ACTIVE_DEPLOYMENT_STATES } },
    orderBy: { requestedAt: 'desc' }
  });
  if (active) {
    const check = await ensureUpdateCheck(client, installation, active, now);
    return { status: 'ACTIVE_DEPLOYMENT', edgeAgentId: installation.edgeAgentId, deploymentId: active.id, check };
  }

  const result = await client.$transaction(async (tx) => {
    const deployment = await tx.edgeDeployment.create({
      data: {
        tenantId: installation.tenantId,
        edgeAgentId: installation.edgeAgentId,
        installationId: installation.installationId,
        releaseId: release.id,
        targetVersion: release.version,
        requestedByUserId: null,
        previousVersion: current || null
      }
    });
    await tx.edgeInstallation.update({
      where: { edgeAgentId: installation.edgeAgentId },
      data: { desiredVersion: release.version, updaterState: 'PENDING' }
    });
    const request = await tx.edgeRelayRequest.create({
      data: {
        tenantId: installation.tenantId,
        edgeAgentId: installation.edgeAgentId,
        action: 'UPDATE_CHECK',
        requestBody: { reason: 'FLEET_SELF_HEAL_V95_4', deploymentId: deployment.id, targetVersion: release.version },
        expiresAt: new Date(now.getTime() + 300000)
      }
    });
    return { deployment, request };
  });
  return { status: 'SCHEDULED', edgeAgentId: installation.edgeAgentId, deploymentId: result.deployment.id, updateCheckId: result.request.id };
}

async function ensureFleetRollout(client = prisma) {
  const manifest = readBundledManifest();
  const targetVersion = String(manifest.fleetRolloutVersion || '').trim();
  if (!targetVersion) return { active: false, targetVersion: null, summary: {} };
  const bundled = normalizeBundledRelease(targetVersion, manifest.releases?.[targetVersion]);
  if (!bundled) return { active: false, targetVersion, invalid: true, summary: {} };

  await ensureBundledGlobalReleases(client);
  const release = await client.edgeRelease.findFirst({ where: { tenantId: null, version: targetVersion, enabled: true } });
  if (!release || String(release.sha256 || '').toLowerCase() !== bundled.sha256) {
    return { active: false, targetVersion, conflict: true, summary: {} };
  }

  const installations = await client.edgeInstallation.findMany({ orderBy: { creadoEn: 'asc' } });
  const results = [];
  const now = new Date();
  for (const installation of installations) {
    try {
      results.push(await scheduleFleetInstallation(client, release, installation, now));
    } catch (error) {
      results.push({ status: 'ERROR', edgeAgentId: installation.edgeAgentId, error: error?.code || error?.message || String(error) });
    }
  }
  const summary = results.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  return { active: true, targetVersion, releaseId: release.id, installations: installations.length, summary, results };
}

let fleetTimer = null;
function startFleetRolloutLoop() {
  if (fleetTimer || process.env.NODE_ENV !== 'production' || process.env.EDGE_FLEET_ROLLOUT_ENABLED === 'false') return;
  const run = async () => {
    try {
      const result = await ensureFleetRollout();
      if (result.active && (result.summary.SCHEDULED || result.summary.ERROR)) {
        console.log('[edge-fleet-rollout]', JSON.stringify({ targetVersion: result.targetVersion, summary: result.summary }));
      }
    } catch (error) {
      console.warn('[edge-fleet-rollout] skipped', error?.code || error?.message || error);
    }
  };
  const first = setTimeout(run, 8000);
  first.unref?.();
  fleetTimer = setInterval(run, FLEET_SWEEP_MS);
  fleetTimer.unref?.();
}

startFleetRolloutLoop();

module.exports = {
  MANIFEST_PATH,
  ARTIFACT_ROOT,
  fallbackArtifactUrl,
  readBundledManifest,
  normalizeBundledRelease,
  compareEdgeVersions,
  ensureBundledGlobalReleases,
  ensureFleetRollout,
  startFleetRolloutLoop
};
