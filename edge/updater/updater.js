const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function exec(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { stdio: 'pipe', windowsHide: true, ...options });
    let out = '';
    let err = '';
    p.stdout?.on('data', (d) => { out += d; });
    p.stderr?.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => code === 0
      ? resolve({ out, err })
      : reject(Object.assign(new Error(err || `${command} exited ${code}`), { code: `EXIT_${code}` })));
  });
}

async function sha256File(file) {
  const h = crypto.createHash('sha256');
  const s = fs.createReadStream(file);
  for await (const chunk of s) h.update(chunk);
  return h.digest('hex');
}

async function copyIfExists(src, dst) {
  try {
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

class EdgeUpdater {
  constructor({ central, store, appRoot = path.resolve(__dirname, '..'), dataDir, enabled = false, restartDelayMs = 2000 }) {
    this.central = central;
    this.store = store;
    this.appRoot = appRoot;
    this.dataDir = dataDir || path.join(appRoot, 'data');
    this.enabled = Boolean(enabled);
    this.restartDelayMs = Math.max(750, Number(restartDelayMs) || 2000);
    this.running = false;
  }

  async report(deploymentId, state, extra = {}) {
    try {
      await this.central('/edge/api/v1/update/report', {
        method: 'POST',
        body: JSON.stringify({ deploymentId, state, ...extra })
      });
    } catch {}
  }

  async manifest() {
    return (await this.central('/edge/api/v1/update/manifest')).data;
  }

  async backup(deploymentId, currentVersion) {
    const root = path.join(this.dataDir, 'backups', `${Date.now()}-${currentVersion || 'unknown'}`);
    await fsp.mkdir(root, { recursive: true });
    await copyIfExists(process.env.EDGE_DB_PATH || path.join(this.dataDir, 'vantixgc-edge.sqlite'), path.join(root, 'vantixgc-edge.sqlite'));
    await copyIfExists(path.join(this.appRoot, '.env'), path.join(root, '.env'));
    await copyIfExists(path.join(this.appRoot, 'version.json'), path.join(root, 'version.json'));
    await this.report(deploymentId, 'BACKUP', { backupPath: root, evidence: { currentVersion } });
    return root;
  }

  async download(url, dest) {
    const response = await fetch(url, { signal: AbortSignal.timeout(Number(process.env.EDGE_UPDATE_DOWNLOAD_TIMEOUT_MS || 120000)) });
    if (!response.ok) throw new Error(`Descarga update HTTP ${response.status}`);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    for await (const chunk of response.body) file.write(chunk);
    await new Promise((resolve, reject) => file.end((error) => error ? reject(error) : resolve()));
  }

  async extract(zip, dest) {
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.mkdir(dest, { recursive: true });
    if (process.platform === 'win32') {
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`]);
    } else {
      await exec('unzip', ['-q', '-o', zip, '-d', dest]);
    }
  }

  async validateStagedRelease(staged) {
    // These files are part of the managed boot contract. Validate them before
    // changing edge/current so a malformed ZIP can never take the live agent offline.
    const required = [
      path.join(staged, 'agent', 'server.js'),
      path.join(staged, 'agent', 'store.js'),
      path.join(staged, 'agent', 'universal-entry.js'),
      path.join(staged, 'runtime', 'vertical-registry.js'),
      path.join(staged, 'print-spooler', 'escpos.js'),
      path.join(staged, 'version.json')
    ];
    for (const file of required) {
      try { await fsp.access(file, fs.constants.R_OK); }
      catch { throw Object.assign(new Error(`El paquete Edge no contiene ${path.relative(staged, file)}`), { code: 'EDGE_UPDATE_PACKAGE_INVALID' }); }
    }
  }

  async atomicInstall(staged, deployment) {
    const releases = path.join(this.appRoot, 'releases');
    const target = path.join(releases, deployment.targetVersion);
    const currentLink = path.join(this.appRoot, 'current');
    await fsp.mkdir(releases, { recursive: true });
    await fsp.rm(target, { recursive: true, force: true });
    await fsp.rename(staged, target);
    let previous = null;
    try { previous = await fsp.readlink(currentLink); } catch {}
    const tmp = `${currentLink}.next`;
    await fsp.rm(tmp, { force: true, recursive: true });
    await fsp.symlink(target, tmp, process.platform === 'win32' ? 'junction' : 'dir');
    await fsp.rm(currentLink, { force: true, recursive: true });
    await fsp.rename(tmp, currentLink);
    return { target, previous, currentLink };
  }

  async rollback(install) {
    if (!install?.currentLink) return false;
    if (!install.previous) {
      // First managed release: remove current so the supervisor falls back to the base agent shipped by the installer.
      await fsp.rm(install.currentLink, { force: true, recursive: true });
      return true;
    }
    const tmp = `${install.currentLink}.rollback`;
    await fsp.rm(tmp, { force: true, recursive: true });
    await fsp.symlink(install.previous, tmp, process.platform === 'win32' ? 'junction' : 'dir');
    await fsp.rm(install.currentLink, { force: true, recursive: true });
    await fsp.rename(tmp, install.currentLink);
    return true;
  }

  async writePendingActivation({ deploymentId, release, deployment, install, backupPath, sha256 }) {
    const marker = path.join(this.dataDir, 'update-pending.json');
    const payload = {
      schema: 'vantixgc-edge-update-pending-v1',
      deploymentId,
      targetVersion: release.version,
      previousVersion: deployment.previousVersion || null,
      previousTarget: install.previous || null,
      target: install.target,
      currentLink: install.currentLink,
      backupPath,
      sha256,
      createdAt: new Date().toISOString()
    };
    await fsp.mkdir(path.dirname(marker), { recursive: true });
    await fsp.writeFile(marker, JSON.stringify(payload, null, 2), 'utf8');
    return marker;
  }

  scheduleRestart() {
    const timer = setTimeout(() => process.exit(75), this.restartDelayMs);
    timer.unref?.();
  }

  async checkNow() {
    if (!this.enabled || this.running) return { skipped: true, reason: this.enabled ? 'RUNNING' : 'DISABLED' };
    this.running = true;
    let deploymentId = null;
    let install = null;
    try {
      const manifest = await this.manifest();
      if (!manifest?.updateAvailable) return { updated: false };
      deploymentId = manifest.deployment.id;
      const work = path.join(this.dataDir, 'updates', deploymentId);
      const zip = path.join(work, 'release.zip');
      const staged = path.join(work, 'staged');
      await fsp.mkdir(work, { recursive: true });
      await this.report(deploymentId, 'DOWNLOADING');
      await this.download(manifest.release.artifactUrl, zip);
      const actual = await sha256File(zip);
      if (actual.toLowerCase() !== String(manifest.release.sha256).toLowerCase()) {
        throw Object.assign(new Error('SHA-256 del update no coincide'), { code: 'EDGE_UPDATE_HASH_MISMATCH' });
      }
      const backupPath = await this.backup(deploymentId, manifest.deployment.previousVersion);
      await this.extract(zip, staged);
      await this.validateStagedRelease(staged);
      await this.report(deploymentId, 'INSTALLING', { backupPath });
      install = await this.atomicInstall(staged, manifest.deployment);
      const marker = await this.writePendingActivation({
        deploymentId,
        release: manifest.release,
        deployment: manifest.deployment,
        install,
        backupPath,
        sha256: actual
      });
      // The supervisor, not the old agent process, performs the real health check.
      // Exit 75 asks the supervisor to restart from edge/current, then it reports SUCCESS or ROLLED_BACK.
      this.scheduleRestart();
      return { updated: true, version: manifest.release.version, restartScheduled: true, activationMarker: marker };
    } catch (error) {
      if (deploymentId) {
        let rolledBack = false;
        try { rolledBack = await this.rollback(install); } catch {}
        await this.report(deploymentId, rolledBack ? 'ROLLED_BACK' : 'FAILED', {
          errorCode: error.code || 'EDGE_UPDATE_FAILED',
          errorMessage: error.message,
          evidence: { rollback: rolledBack, phase: 'PRE_ACTIVATION' }
        });
      }
      throw error;
    } finally {
      this.running = false;
    }
  }
}

module.exports = { EdgeUpdater, sha256File };
