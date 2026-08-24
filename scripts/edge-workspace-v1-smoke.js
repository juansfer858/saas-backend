const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const workspace = read('edge/agent/workspace-entry.js');
const workspaceHtml = read('edge/workspace/public/index.html');
const supervisor = read('edge/supervisor/supervisor.js');
const installer = read('edge/supervisor/install-windows.ps1');
const routes = read('src/modules/edge/edge.routes.js');
const service = read('src/modules/edge/edge-workspace.service.js');
const schema = read('prisma/edge-workspace-v1.prisma');
const restaurantHtml = read('src/web/restaurant.html');

for (const file of ['edge/agent/workspace-entry.js','src/modules/edge/edge-workspace.service.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

assert.match(schema, /model EdgeLocalAccessGrant/);
assert.match(service, /createLocalAccessGrant/);
assert.match(service, /consumeLocalAccessGrant/);
assert.match(service, /effectivePermissions/);
assert.match(routes, /local-access-grant/);
assert.match(routes, /local-access\/consume/);
assert.match(workspace, /vantixgc_edge_workspace/);
assert.match(workspace, /workspace\/api\/state/);
assert.match(workspace, /RESTAURANT_TABLE_CLOSE/);
assert.match(workspace, /RESTAURANT_CASH_OPEN/);
assert.match(workspace, /RESTAURANT_CASH_CLOSE/);
assert.match(workspace, /RESTAURANT_ACCOUNT_REQUEST/);
assert.match(workspace, /require\('\.\/server'\)/);
assert.match(workspaceHtml, /Centro de Control/);
assert.match(workspaceHtml, /LOCAL \+ NUBE/);
assert.match(workspaceHtml, /LOCAL · SIN INTERNET/);
assert.doesNotMatch(workspaceHtml, /emergencia/i);
assert.match(supervisor, /workspace-entry\.js/);
assert.match(installer, /VantixGC Restaurantes\.url/);
assert.match(installer, /app\/centro-de-control/);
assert.match(restaurantHtml, /Trabajar en sede/);
assert.match(restaurantHtml, /local-access-grant/);

console.log('EDGE WORKSPACE V1 STATIC SMOKE OK');
