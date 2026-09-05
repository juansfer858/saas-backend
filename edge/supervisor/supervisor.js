const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.EDGE_DATA_DIR || path.join(ROOT, 'data');
const LOG = path.join(DATA, 'supervisor.log');
const ENV_FILE = path.join(ROOT, '.env');
const UPDATE_MARKER = path.join(DATA, 'update-pending.json');
const LAST_UPDATE_RESULT = path.join(DATA, 'update-last-result.json');
const NODE = process.env.EDGE_NODE_PATH || (fs.existsSync(path.join(ROOT, 'runtime', 'node.exe')) ? path.join(ROOT, 'runtime', 'node.exe') : process.execPath);
const SUPERVISOR_REVISION = 'restart-liveness-v2';

let child = null;
let stopping = false;
let failures = 0;
let pendingHealthFailures = 0;
let timer = null;
let updateBusy = false;

fs.mkdirSync(DATA, { recursive: true });

function log(...args) {
  const line = `${new Date().toISOString()} ${args.join(' ')}\n`;
  fs.appendFileSync(LOG, line);
  process.stdout.write(line);
}

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function runtimeEnv() {
  const env = { ...process.env, ...parseEnvFile(ENV_FILE) };
  if (!env.EDGE_INSTALL_ROOT) env.EDGE_INSTALL_ROOT = ROOT;
  if (!env.EDGE_DATA_DIR) env.EDGE_DATA_DIR = DATA;
  return env;
}

function currentEntry() {
  const env = runtimeEnv();
  if (env.EDGE_AGENT_ENTRY) return env.EDGE_AGENT_ENTRY;
  const activatedUniversal = path.join(ROOT, 'current', 'agent', 'universal-entry.js');
  const activatedWorkspace = path.join(ROOT, 'current', 'agent', 'workspace-entry.js');
  const activatedServer = path.join(ROOT, 'current', 'agent', 'server.js');
  const baseUniversal = path.join(ROOT, 'agent', 'universal-entry.js');
  const baseWorkspace = path.join(ROOT, 'agent', 'workspace-entry.js');
  if (fs.existsSync(activatedUniversal)) return activatedUniversal;
  if (fs.existsSync(activatedWorkspace)) return activatedWorkspace;
  if (fs.existsSync(activatedServer)) return activatedServer;
  if (fs.existsSync(baseUniversal)) return baseUniversal;
  return fs.existsSync(baseWorkspace) ? baseWorkspace : path.join(ROOT, 'agent', 'server.js');
}

function healthUrl() {
  const env = runtimeEnv();
  return env.EDGE_SUPERVISOR_HEALTH_URL || `http://127.0.0.1:${env.EDGE_PORT || 8788}/api/status`;
}

async function health() {
  try {
    const response = await fetch(healthUrl(), { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function readMarker() {
  try { return JSON.parse(fs.readFileSync(UPDATE_MARKER, 'utf8')); } catch { return null; }
}

function writeLastResult(result) {
  try { fs.writeFileSync(LAST_UPDATE_RESULT, JSON.stringify({ ...result, recordedAt: new Date().toISOString() }, null, 2)); } catch {}
}

async function reportUpdate(marker, state, extra = {}) {
  const env = runtimeEnv();
  const core = String(env.CORE_BASE_URL || '').replace(/\/$/, '');
  if (!core || !env.EDGE_AGENT_ID || !env.EDGE_AGENT_KEY || !marker?.deploymentId) return false;
  try {
    const response = await fetch(`${core}/edge/api/v1/update/report`, {
      method: 'POST',
      signal: AbortSignal.timeout(Number(env.EDGE_HTTP_TIMEOUT_MS || 5000)),
      headers: {
        'Content-Type': 'application/json',
        'x-vantix-edge-id': env.EDGE_AGENT_ID,
        'x-vantix-edge-key': env.EDGE_AGENT_KEY
      },
      body: JSON.stringify({ deploymentId: marker.deploymentId, state, ...extra })
    });
    return response.ok;
  } catch {
    return false;
  }
}

function schedule(waitOverrideMs = null) {
  if (stopping) return;
  const wait = waitOverrideMs == null
    ? Math.min(1000 * (2 ** Math.min(failures, 6)), 60000)
    : Math.max(250, Number(waitOverrideMs) || 1000);
  clearTimeout(timer);
  // This timer MUST stay referenced. If it is unref'ed and the agent exits with
  // code 75, Node can terminate the supervisor before the replacement starts.
  timer = setTimeout(start, wait);
}

async function rollbackPending(reason) {
  if (updateBusy) return;
  updateBusy = true;
  const marker = readMarker();
  if (!marker) { updateBusy = false; return; }
  try {
    const currentLink = marker.currentLink || path.join(ROOT, 'current');
    let fallbackBase = false;
    if (marker.previousTarget) {
      const tmp = `${currentLink}.rollback`;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.symlinkSync(marker.previousTarget, tmp, process.platform === 'win32' ? 'junction' : 'dir');
      fs.rmSync(currentLink, { recursive: true, force: true });
      fs.renameSync(tmp, currentLink);
    } else {
      fs.rmSync(currentLink, { recursive: true, force: true });
      fallbackBase = true;
    }
    await reportUpdate(marker, 'ROLLED_BACK', {
      errorCode: 'EDGE_UPDATE_HEALTH_FAILED',
      errorMessage: reason,
      evidence: { supervisorRollback: true, fallbackBase, pendingHealthFailures }
    });
    writeLastResult({ state: 'ROLLED_BACK', deploymentId: marker.deploymentId, targetVersion: marker.targetVersion, reason, fallbackBase });
    log('UPDATE_ROLLBACK', marker.targetVersion || '', fallbackBase ? 'BASE_AGENT' : 'PREVIOUS_RELEASE', reason);
    fs.rmSync(UPDATE_MARKER, { force: true });
    pendingHealthFailures = 0;
    failures = 0;
    if (child) {
      try { child.kill('SIGTERM'); } catch {}
    } else schedule();
  } finally {
    updateBusy = false;
  }
}

async function completePendingIfHealthy() {
  if (updateBusy) return;
  const marker = readMarker();
  if (!marker) return;
  updateBusy = true;
  try {
    const reported = await reportUpdate(marker, 'SUCCESS', {
      backupPath: marker.backupPath || null,
      evidence: {
        supervisorHealthCheck: true,
        target: marker.target || null,
        sha256: marker.sha256 || null,
        supervisorRevision: SUPERVISOR_REVISION
      }
    });
    if (!reported) return;
    writeLastResult({ state: 'SUCCESS', deploymentId: marker.deploymentId, targetVersion: marker.targetVersion });
    fs.rmSync(UPDATE_MARKER, { force: true });
    pendingHealthFailures = 0;
    log('UPDATE_SUCCESS', marker.targetVersion || '');
  } finally {
    updateBusy = false;
  }
}

function start() {
  if (stopping || child) return;
  const entry = currentEntry();
  const env = runtimeEnv();
  log('START', NODE, entry, `supervisor=${SUPERVISOR_REVISION}`);
  child = spawn(NODE, [entry], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', (d) => fs.appendFileSync(LOG, d));
  child.stderr.on('data', (d) => fs.appendFileSync(LOG, d));
  child.on('exit', (code, signal) => {
    log('EXIT', String(code), String(signal));
    child = null;

    if (Number(code) === 75) {
      // Exit 75 is an intentional updater handoff, not a health failure.
      failures = 0;
      pendingHealthFailures = 0;
      log('UPDATE_RESTART_REQUEST accepted');
      schedule(1000);
      return;
    }

    failures += 1;
    if (readMarker()) {
      pendingHealthFailures += 1;
      if (pendingHealthFailures >= 3) {
        void rollbackPending(`La nueva versión terminó repetidamente antes de quedar saludable. exit=${code} signal=${signal}`);
        return;
      }
    }
    schedule();
  });
}

// The health interval is deliberately referenced. The supervisor is the long-lived
// Windows service process and must not disappear when the child agent restarts.
const healthTimer = setInterval(async () => {
  if (stopping) return;
  if (await health()) {
    failures = 0;
    pendingHealthFailures = 0;
    await completePendingIfHealthy();
    return;
  }
  if (readMarker()) {
    pendingHealthFailures += 1;
    if (pendingHealthFailures >= 3) {
      await rollbackPending('La nueva versión no respondió correctamente al health check del supervisor.');
      return;
    }
  }
  if (child) {
    log('HEALTH_FAIL restart');
    try { child.kill('SIGTERM'); } catch {}
  } else {
    schedule();
  }
}, 10000);

function stop() {
  stopping = true;
  clearTimeout(timer);
  clearInterval(healthTimer);
  log('SUPERVISOR_STOP');
  if (child) {
    try { child.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
start();
