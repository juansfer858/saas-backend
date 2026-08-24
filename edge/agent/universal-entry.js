'use strict';

const fs = require('node:fs');
const path = require('node:path');
const registry = require('../runtime/vertical-registry');

const CORE_BASE_URL = String(process.env.CORE_BASE_URL || '').replace(/\/$/, '');
const EDGE_AGENT_ID = process.env.EDGE_AGENT_ID || '';
const EDGE_AGENT_KEY = process.env.EDGE_AGENT_KEY || '';
const INSTALL_ROOT = process.env.EDGE_INSTALL_ROOT || path.resolve(__dirname, '..');
const DATA_DIR = process.env.EDGE_DATA_DIR || path.join(INSTALL_ROOT, 'data');
const MANIFEST_FILE = path.join(DATA_DIR, 'vertical-manifest.json');

function readCachedManifest() {
  try {
    const value = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    return value?.manifest || value || null;
  } catch {
    return null;
  }
}

function writeCachedManifest(manifest) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify({ manifest, cachedAt: new Date().toISOString() }, null, 2));
  } catch {}
}

async function fetchManifest() {
  if (!CORE_BASE_URL || !EDGE_AGENT_ID || !EDGE_AGENT_KEY) return null;
  try {
    const response = await fetch(`${CORE_BASE_URL}/edge/api/v1/vertical-manifest`, {
      signal: AbortSignal.timeout(Number(process.env.EDGE_HTTP_TIMEOUT_MS || 5000)),
      headers: {
        'x-vantix-edge-id': EDGE_AGENT_ID,
        'x-vantix-edge-key': EDGE_AGENT_KEY
      }
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body?.ok || !body?.data?.core) return null;
    writeCachedManifest(body.data);
    return body.data;
  } catch {
    return null;
  }
}

function startWithManifest(manifest) {
  const chosen = registry.primaryAdapter(manifest);
  process.env.EDGE_VERTICAL_MANIFEST_JSON = JSON.stringify(manifest || { core: { code: 'CORE' }, verticals: [] });
  if (chosen?.adapter?.entry && fs.existsSync(chosen.adapter.entry)) {
    process.env.EDGE_ACTIVE_VERTICAL = chosen.adapter.code;
    process.env.EDGE_ACTIVE_ADAPTER = chosen.adapter.adapter;
    require(chosen.adapter.entry);
    return;
  }
  process.env.EDGE_ACTIVE_VERTICAL = 'CORE';
  process.env.EDGE_ACTIVE_ADAPTER = '';
  require('./server');
}

(async () => {
  const online = await fetchManifest();
  const cached = online || readCachedManifest();
  startWithManifest(cached || { core: { code: 'CORE', runtime: 'EDGE_UNIVERSAL_V1' }, verticals: [] });
})().catch((error) => {
  console.error(`EDGE_UNIVERSAL_ENTRY_ERROR: ${error.message || error}`);
  startWithManifest(readCachedManifest() || { core: { code: 'CORE', runtime: 'EDGE_UNIVERSAL_V1' }, verticals: [] });
});
