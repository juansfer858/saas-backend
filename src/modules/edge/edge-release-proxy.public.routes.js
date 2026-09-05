'use strict';

const express = require('express');
const { Readable } = require('node:stream');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const router = express.Router();
const ALLOWED_ARTIFACT_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com'
]);

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

async function resolveArtifact(deploymentId, expectedSha) {
  const deployment = await prisma.edgeDeployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) throw new AppError(404, 'Despliegue Edge no encontrado', 'EDGE_ARTIFACT_DEPLOYMENT_NOT_FOUND');
  const release = await prisma.edgeRelease.findUnique({ where: { id: deployment.releaseId } });
  if (!release?.enabled) throw new AppError(404, 'Release Edge no disponible', 'EDGE_ARTIFACT_RELEASE_NOT_FOUND');
  if (!expectedSha || String(expectedSha).toLowerCase() !== String(release.sha256).toLowerCase()) {
    throw new AppError(403, 'Firma de descarga Edge inválida', 'EDGE_ARTIFACT_SIGNATURE_INVALID');
  }
  let upstream;
  try { upstream = new URL(release.artifactUrl); }
  catch { throw new AppError(502, 'URL del release Edge inválida', 'EDGE_ARTIFACT_URL_INVALID'); }
  if (upstream.protocol !== 'https:' || !ALLOWED_ARTIFACT_HOSTS.has(upstream.hostname.toLowerCase())) {
    throw new AppError(502, 'Host del release Edge no autorizado', 'EDGE_ARTIFACT_HOST_NOT_ALLOWED');
  }
  return { deployment, release, upstream };
}

router.get('/update/artifact/:deploymentId', async (req, res, next) => {
  try {
    const { release, upstream } = await resolveArtifact(req.params.deploymentId, req.query.sha);
    const response = await fetch(upstream, {
      redirect: 'follow',
      signal: AbortSignal.timeout(Math.max(5000, Number(process.env.EDGE_ARTIFACT_PROXY_TIMEOUT_MS || 120000)))
    });
    if (!response.ok || !response.body) {
      throw new AppError(502, `Origen del release Edge respondió HTTP ${response.status}`, 'EDGE_ARTIFACT_UPSTREAM_HTTP_ERROR');
    }
    res.set('Content-Type', response.headers.get('content-type') || 'application/zip');
    const length = response.headers.get('content-length');
    if (length) res.set('Content-Length', length);
    res.set('Content-Disposition', `attachment; filename="vantixgc-edge-${release.version}.zip"`);
    res.set('Cache-Control', 'public, max-age=300, immutable');
    res.set('X-VantixGC-Edge-Artifact', 'CORE_PROXY_V1');
    Readable.fromWeb(response.body).on('error', next).pipe(res);
  } catch (error) { next(error); }
});

module.exports = { edgeReleaseProxyPublicRouter: router, proxyArtifactUrl, resolveArtifact, ALLOWED_ARTIFACT_HOSTS };
