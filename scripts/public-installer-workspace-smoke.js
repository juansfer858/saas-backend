const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const zip = path.join(__dirname, '..', 'public', 'downloads', 'VantixGC_Restaurantes_Instalador_Windows.zip');
const expectedCommit = '2fa391d1199fb3ed3f5460b2bf84627af3360bc0';

function unzip(args) {
  const result = spawnSync('unzip', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || `unzip ${args.join(' ')} falló`);
  return result.stdout;
}

const files = unzip(['-Z1', zip]).trim().split(/\r?\n/).sort();
assert.deepEqual(files, [
  'INSTALAR_VANTIXGC_RESTAURANTES.cmd',
  'INSTALAR_VANTIXGC_RESTAURANTES.ps1',
  'LEEME.txt'
].sort());

const ps1 = unzip(['-p', zip, 'INSTALAR_VANTIXGC_RESTAURANTES.ps1']);
const readme = unzip(['-p', zip, 'LEEME.txt']);
const cmd = unzip(['-p', zip, 'INSTALAR_VANTIXGC_RESTAURANTES.cmd']);

assert.match(ps1, new RegExp(`\\$Commit = '${expectedCommit}'`));
assert.match(ps1, /22\.23\.2/);
assert.match(ps1, /Workspace universal/i);
assert.match(ps1, /app\/centro-de-control/);
assert.match(ps1, /install-windows\.ps1/);
assert.match(ps1, /EDGE_AGENT_ID/);
assert.match(ps1, /EDGE_AGENT_KEY/);
assert.match(readme, /2\.1\.0-workspace\.1/);
assert.match(readme, new RegExp(expectedCommit));
assert.match(readme, /Edge Universal/);
assert.match(readme, /manifest seguro del Core/);
assert.match(readme, /Una sede usa un Edge principal/);
assert.match(cmd, /INSTALAR_VANTIXGC_RESTAURANTES\.ps1/);

console.log('PUBLIC INSTALLER UNIVERSAL EDGE PIN OK');
