'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Readable } = require('node:stream');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const router = express.Router();
const CORE_LOCAL_MARKER = 'CORE_LOCAL_V2';
const CORE_PROXY_MARKER = 'CORE_PROXY_V1';
const LOCAL_ARTIFACT_ROOT = path.resolve(__dirname, '../../../public/edge-releases');
const ALLOWED_ARTIFACT_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com'
]);
const localHashCache = new Map();

function forwardedOrigin(req) {
  const configured = String(process.env.EDGE_ARTIFACT_PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) throw new AppError(500, 'No fue posible resolver el origen público del Core', 'EDGE_ARTIFACT_ORIGIN_MISSING');
  return `${proto}://${host}`;
}

function proxyArtifactUrl(req, deploymentId, sha256) {
  return `${forwardedOrigin(req)}/edge/api/v1/update/artifact/${encodeURIComponent(deploymentId)}?sha=${encodeURIComponent(sha256)}`;
}

async function resolveRelease(deploymentId, expectedSha) {
  const deployment = await prisma.edgeDeployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) throw new AppError(404, 'Despliegue Edge no encontrado', 'EDGE_ARTIFACT_DEPLOYMENT_NOT_FOUND');
  const release = await prisma.edgeRelease.findUnique({ where: { id: deployment.releaseId } });
  if (!release?.enabled) throw new AppError(404, 'Release Edge no disponible', 'EDGE_ARTIFACT_RELEASE_NOT_FOUND');
  if (!expectedSha || String(expectedSha).toLowerCase() !== String(release.sha256).toLowerCase()) {
    throw new AppError(403, 'Firma de descarga Edge inválida', 'EDGE_ARTIFACT_SIGNATURE_INVALID');
  }
  return { deployment, release };
}

function localArtifactPath(release) {
  const version = String(release?.version || '').trim();
  if (!/^[0-9A-Za-z._-]+$/.test(version)) return null;
  return path.join(LOCAL_ARTIFACT_ROOT, `vantixgc-edge-${version}.zip`);
}

async function sha256File(filePath, stat) {
  const cacheKey = `${filePath}:${stat.size}:${stat.mtimeMs}`;
  if (localHashCache.has(cacheKey)) return localHashCache.get(cacheKey);
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  const digest = hash.digest('hex');
  localHashCache.clear();
  localHashCache.set(cacheKey, digest);
  return digest;
}

async function resolveLocalArtifact(release) {
  const filePath = localArtifactPath(release);
  if (!filePath) return null;
  let stat;
  try { stat = await fs.promises.stat(filePath); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile()) return null;
  const actualSha = await sha256File(filePath, stat);
  if (actualSha.toLowerCase() !== String(release.sha256).toLowerCase()) {
    throw new AppError(502, 'SHA-256 del artifact Edge local no coincide con el release', 'EDGE_ARTIFACT_LOCAL_HASH_MISMATCH');
  }
  return { filePath, stat, actualSha };
}

function artifactHeaders(res, release, length, marker) {
  res.set('Content-Type', 'application/zip');
  if (length) res.set('Content-Length', String(length));
  res.set('Content-Disposition', `attachment; filename="vantixgc-edge-${release.version}.zip"`);
  res.set('Cache-Control', 'public, max-age=300, immutable');
  res.set('X-VantixGC-Edge-Artifact', marker);
  res.set('X-Content-Type-Options', 'nosniff');
}

function resolveUpstream(release) {
  let upstream;
  try { upstream = new URL(release.artifactUrl); }
  catch { throw new AppError(502, 'URL del release Edge inválida', 'EDGE_ARTIFACT_URL_INVALID'); }
  if (upstream.protocol !== 'https:' || !ALLOWED_ARTIFACT_HOSTS.has(upstream.hostname.toLowerCase())) {
    throw new AppError(502, 'Host del release Edge no autorizado', 'EDGE_ARTIFACT_HOST_NOT_ALLOWED');
  }
  return upstream;
}

router.get('/update/artifact/:deploymentId', async (req, res, next) => {
  try {
    const { release } = await resolveRelease(req.params.deploymentId, req.query.sha);
    const local = await resolveLocalArtifact(release);
    if (local) {
      artifactHeaders(res, release, local.stat.size, CORE_LOCAL_MARKER);
      fs.createReadStream(local.filePath).on('error', next).pipe(res);
      return;
    }

    const upstream = resolveUpstream(release);
    const response = await fetch(upstream, {
      redirect: 'follow',
      signal: AbortSignal.timeout(Math.max(5000, Number(process.env.EDGE_ARTIFACT_PROXY_TIMEOUT_MS || 120000)))
    });
    if (!response.ok || !response.body) {
      throw new AppError(502, `Origen del release Edge respondió HTTP ${response.status}`, 'EDGE_ARTIFACT_UPSTREAM_HTTP_ERROR');
    }
    artifactHeaders(res, release, response.headers.get('content-length'), CORE_PROXY_MARKER);
    Readable.fromWeb(response.body).on('error', next).pipe(res);
  } catch (error) { next(error); }
});

module.exports = {
  CORE_LOCAL_MARKER,
  CORE_PROXY_MARKER,
  LOCAL_ARTIFACT_ROOT,
  edgeReleaseProxyPublicRouter: router,
  proxyArtifactUrl,
  resolveRelease,
  resolveLocalArtifact,
  ALLOWED_ARTIFACT_HOSTS
};
