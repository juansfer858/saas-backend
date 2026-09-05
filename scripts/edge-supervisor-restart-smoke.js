'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const source = path.join(repo, 'edge', 'supervisor', 'supervisor.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vantix-supervisor-'));
fs.mkdirSync(path.join(root, 'supervisor'), { recursive: true });
fs.mkdirSync(path.join(root, 'agent'), { recursive: true });
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.copyFileSync(source, path.join(root, 'supervisor', 'supervisor.js'));

fs.writeFileSync(path.join(root, 'agent', 'server.js'), `
const fs=require('node:fs'),path=require('node:path');
const file=path.join(process.env.EDGE_DATA_DIR,'restart-count.txt');
const n=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1;
fs.writeFileSync(file,String(n));
if(n===1) process.exit(75);
setInterval(()=>{},1000);
`, 'utf8');

const supervisor = spawn(process.execPath, [path.join(root, 'supervisor', 'supervisor.js')], {
  cwd: root,
  env: { ...process.env, EDGE_DATA_DIR: path.join(root, 'data'), EDGE_PORT: '18991' },
  stdio: 'ignore'
});

setTimeout(() => {
  try {
    const count = Number(fs.readFileSync(path.join(root, 'data', 'restart-count.txt'), 'utf8'));
    assert.ok(count >= 2, `supervisor did not restart child after exit 75; starts=${count}`);
    assert.equal(supervisor.exitCode, null, 'supervisor must stay alive after scheduling child restart');
    console.log(JSON.stringify({ ok:true, childStarts:count, supervisorAlive:true }));
  } finally {
    supervisor.kill('SIGTERM');
    setTimeout(() => process.exit(0), 200).unref();
  }
}, 4500);
