'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const MAGIC = Buffer.from('VXP15B01');
const IV_BYTES = 12;
const TAG_BYTES = 16;
let running = false;

function text(v) { return String(v ?? '').trim(); }
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('error', reject); input.on('data', (chunk) => hash.update(chunk)); input.on('end', () => resolve(hash.digest('hex')));
  });
}
function keyFromSecret(secret) {
  if (text(secret).length < 24) throw new Error('P15_BACKUP_SECRET debe tener al menos 24 caracteres.');
  return crypto.createHash('sha256').update(text(secret), 'utf8').digest();
}
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore','pipe','pipe'], ...options });
    let stdout = ''; let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; }); child.stderr?.on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${path.basename(command)} exit=${code}: ${stderr || stdout}`)));
  });
}
function databaseParts(databaseUrl) {
  const u = new URL(databaseUrl);
  return { host: u.hostname, port: u.port || '5432', user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//,'') };
}
async function encryptFile(inputFile, outputFile, secret) {
  const key = keyFromSecret(secret); const iv = crypto.randomBytes(IV_BYTES);
  const body = `${outputFile}.body-${process.pid}-${Date.now()}`;
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(inputFile); const output = fs.createWriteStream(body);
    input.on('error', reject); output.on('error', reject); output.on('finish', resolve); input.pipe(cipher).pipe(output);
  });
  const tag = cipher.getAuthTag();
  const out = fs.createWriteStream(outputFile, { flags: 'w' });
  out.write(MAGIC); out.write(iv);
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(body); input.on('error', reject); out.on('error', reject); input.on('end', resolve); input.pipe(out, { end: false });
  });
  out.write(tag); out.end(); await once(out, 'finish');
  await fsp.rm(body, { force: true });
  return outputFile;
}
async function decryptFile(inputFile, outputFile, secret) {
  const stat = await fsp.stat(inputFile);
  if (stat.size <= MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error('Backup P15 demasiado pequeño.');
  const fd = await fsp.open(inputFile, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length + IV_BYTES); await fd.read(head, 0, head.length, 0);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Formato de backup P15 inválido.');
    const iv = head.subarray(MAGIC.length);
    const tag = Buffer.alloc(TAG_BYTES); await fd.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFromSecret(secret), iv); decipher.setAuthTag(tag);
    const input = fs.createReadStream(inputFile, { start: MAGIC.length + IV_BYTES, end: stat.size - TAG_BYTES - 1 });
    const output = fs.createWriteStream(outputFile, { flags: 'w' });
    await new Promise((resolve, reject) => {
      input.on('error', reject); decipher.on('error', reject); output.on('error', reject); output.on('finish', resolve); input.pipe(decipher).pipe(output);
    });
  } finally { await fd.close(); }
  return outputFile;
}
async function uploadFile(file, url, token, headers = {}) {
  const target = new URL(url); const transport = target.protocol === 'https:' ? https : http; const stat = await fsp.stat(file);
  return new Promise((resolve, reject) => {
    const req = transport.request({ method: 'PUT', protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, path: `${target.pathname}${target.search}`, headers: { 'content-type':'application/octet-stream','content-length':stat.size, ...(token ? { authorization:`Bearer ${token}` } : {}), ...headers } }, (res) => {
      let body=''; res.on('data',(d)=>{body+=d}); res.on('end',()=> res.statusCode >= 200 && res.statusCode < 300 ? resolve({ status:res.statusCode, body }) : reject(new Error(`Backup upload HTTP ${res.statusCode}: ${body}`)));
    });
    req.on('error', reject); fs.createReadStream(file).on('error', reject).pipe(req);
  });
}
async function copyIfExists(source, destination) {
  try { await fsp.access(source); await fsp.cp(source, destination, { recursive:true, force:true }); return true; } catch { return false; }
}
async function cleanupOldBackups(dir, keep) {
  const rows = (await fsp.readdir(dir, { withFileTypes:true })).filter((x)=>x.isFile() && x.name.endsWith('.vxp15')).map((x)=>x.name);
  const stats = await Promise.all(rows.map(async (name)=>({ name, stat:await fsp.stat(path.join(dir,name)) })));
  stats.sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
  for (const row of stats.slice(Math.max(keep,1))) await fsp.rm(path.join(dir,row.name), { force:true });
}
async function createBackup(env = process.env) {
  if (running) return { ok:false, skipped:'BACKUP_ALREADY_RUNNING' };
  running = true;
  const installDir = text(env.P15_INSTALL_DIR || String.raw`C:\ProgramData\VantixGC\Restaurant-P15-Lab`);
  const backupDir = text(env.P15_BACKUP_DIR || path.join(installDir, 'backups'));
  const pgBin = text(env.P15_PG_BIN || path.join(installDir, 'postgres', 'bin'));
  const secret = text(env.P15_BACKUP_SECRET);
  const db = databaseParts(text(env.DATABASE_URL));
  const keep = Math.max(Number(env.P15_BACKUP_KEEP || 48), 3);
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'vantix-p15-backup-'));
  const stage = path.join(work, 'stage'); await fsp.mkdir(stage, { recursive:true }); await fsp.mkdir(backupDir, { recursive:true });
  try {
    const dump = path.join(stage, 'database.dump');
    await run(path.join(pgBin, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'), ['-h',db.host,'-p',db.port,'-U',db.user,'-d',db.database,'-Fc','--no-owner','--no-privileges','-f',dump], { env:{...process.env,PGPASSWORD:db.password} });
    const configStage = path.join(stage,'config'); await fsp.mkdir(configStage,{recursive:true});
    await copyIfExists(path.join(installDir,'config','runtime.json'), path.join(configStage,'runtime.json'));
    await copyIfExists(path.join(installDir,'config','printers.json'), path.join(configStage,'printers.json'));
    await copyIfExists(path.join(installDir,'files'), path.join(stage,'files'));
    const manifest = {
      format:'VANTIX_RESTAURANT_P15_BACKUP_V1', createdAt:new Date().toISOString(), installationId:text(env.P15_INSTALLATION_ID), tenantSubdomain:text(env.P15_TENANT_SUBDOMAIN), database:db.database,
      files:{ databaseDump:{ name:'database.dump', sha256:await sha256File(dump), bytes:(await fsp.stat(dump)).size } },
      appVersion:text(env.P15_APP_VERSION || 'p15-lab'), node:process.version
    };
    await fsp.writeFile(path.join(stage,'manifest.json'), JSON.stringify(manifest,null,2));
    const zip = path.join(work,'bundle.zip');
    if (process.platform === 'win32') {
      const command = `Compress-Archive -Path '${stage.replace(/'/g,"''")}\\*' -DestinationPath '${zip.replace(/'/g,"''")}' -CompressionLevel Optimal -Force`;
      await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command]);
    } else {
      await run('zip',['-qr',zip,'.'],{cwd:stage});
    }
    const archive = path.join(backupDir, `restaurant-${text(env.P15_TENANT_SUBDOMAIN)||'tenant'}-${stamp}.vxp15`);
    await encryptFile(zip, archive, secret);
    const archiveSha = await sha256File(archive);
    let uploaded = false; let uploadError = null;
    if (text(env.P15_BACKUP_UPLOAD_URL)) {
      try {
        await uploadFile(archive, text(env.P15_BACKUP_UPLOAD_URL), text(env.P15_BACKUP_UPLOAD_TOKEN), { 'x-vantix-installation-id':text(env.P15_INSTALLATION_ID), 'x-vantix-tenant':text(env.P15_TENANT_SUBDOMAIN), 'x-vantix-sha256':archiveSha }); uploaded = true;
      } catch (error) { uploadError = error.message; }
    }
    await cleanupOldBackups(backupDir, keep);
    const result = { ok:true, archive, sha256:archiveSha, bytes:(await fsp.stat(archive)).size, uploaded, uploadError, manifest };
    console.log(`P15_BACKUP_READY ${JSON.stringify(result)}`); return result;
  } finally { running = false; await fsp.rm(work,{recursive:true,force:true}); }
}
async function main() {
  const intervalMs = Math.max(Number(process.env.P15_BACKUP_INTERVAL_MINUTES || 15), 5) * 60 * 1000;
  const runOnce = async()=>{ try { await createBackup(process.env); } catch(error){ console.error(`P15_BACKUP_FAILED: ${error?.stack || error}`); } };
  await runOnce(); const timer=setInterval(runOnce,intervalMs); timer.unref?.(); console.log(`P15_BACKUP_AGENT_READY intervalMs=${intervalMs}`);
  await new Promise(()=>{});
}
if (require.main === module) main().catch((error)=>{console.error(error);process.exitCode=1});
module.exports = { MAGIC, encryptFile, decryptFile, createBackup, uploadFile, databaseParts, sha256File };
