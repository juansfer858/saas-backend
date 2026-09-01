'use strict';

const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { prisma } = require('../../config/prisma');
const { privateLanHost } = require('./edge-restaurant-ingress.service');

function materialVersion(host, port, tables) {
  return crypto.createHash('sha256').update(JSON.stringify({
    host,
    port,
    tables: tables.map((table) => [table.id, table.qrToken])
  })).digest('hex');
}

function localUrl(host, port, qrToken) {
  const displayHost = host.includes(':') ? `[${host}]` : host;
  return `http://${displayHost}:${port}/r/${encodeURIComponent(qrToken)}?mode=lan`;
}

async function buildMaterials(edgeAgent, currentVersion = null) {
  const installation = await prisma.edgeInstallation.findUnique({
    where: { edgeAgentId: edgeAgent.id },
    select: { lanHost: true, lanPort: true }
  });
  const host = privateLanHost(installation?.lanHost);
  const port = Number(installation?.lanPort || 8788);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      available: false,
      reason: 'EDGE_LAN_ADDRESS_NOT_READY',
      version: null,
      generatedAt: new Date().toISOString(),
      tables: []
    };
  }

  const tables = await prisma.restaurantTable.findMany({
    where: { tenantId: edgeAgent.tenantId, active: true, qrToken: { not: null } },
    select: { id: true, code: true, name: true, qrToken: true },
    orderBy: [{ zone: 'asc' }, { code: 'asc' }]
  });
  const version = materialVersion(host, port, tables);
  if (currentVersion && String(currentVersion) === version) {
    return {
      available: true,
      notModified: true,
      version,
      lanHost: host,
      lanPort: port,
      generatedAt: new Date().toISOString(),
      tables: []
    };
  }

  const rows = [];
  for (const table of tables) {
    const url = localUrl(host, port, table.qrToken);
    const svg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320
    });
    rows.push({
      id: table.id,
      code: table.code,
      name: table.name,
      qrToken: table.qrToken,
      localUrl: url,
      svg
    });
  }

  return {
    available: true,
    notModified: false,
    version,
    lanHost: host,
    lanPort: port,
    generatedAt: new Date().toISOString(),
    tables: rows
  };
}

module.exports = {
  materialVersion,
  localUrl,
  buildMaterials
};
