'use strict';

const edgePlatform = require('../edge/edge-platform.service');

const VERSION = '103.0.0';

async function requestPrintQueueSync(tenantId) {
  try {
    const rows = await edgePlatform.listInstallations(tenantId);
    const edge = (Array.isArray(rows) ? rows : []).find((row) => row?.agent?.state === 'ACTIVE' && row?.installation?.online === true);
    if (!edge?.agent?.id) return { requested: false, reason: 'EDGE_OFFLINE' };

    const relay = await edgePlatform.createRelayRequest(
      tenantId,
      edge.agent.id,
      'PRINT_QUEUE',
      { operation: 'POS_RECEIPT_SYNC', source: 'SALES_REPRINT_V103' },
      30
    );
    return {
      requested: true,
      edgeAgentId: edge.agent.id,
      relayRequestId: relay?.id || null,
      operation: 'POS_RECEIPT_SYNC',
      version: VERSION
    };
  } catch (error) {
    return {
      requested: false,
      reason: 'EDGE_SIGNAL_ERROR',
      error: String(error?.code || error?.message || 'EDGE_SIGNAL_ERROR').slice(0, 160)
    };
  }
}

module.exports = { VERSION, requestPrintQueueSync };
