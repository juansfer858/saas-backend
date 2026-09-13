const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const workspace = read('edge/agent/workspace-entry.js');
const workspaceV28 = read('edge/agent/workspace-entry-v28.js');
const workspaceV59 = read('edge/agent/workspace-entry-v59.js');
const localFirstP0 = read('edge/agent/workspace-entry-local-first-p0.js');
const restaurantEntry = read('edge/agent/restaurant-entry-v2.js');
const workspaceHtml = read('edge/workspace/public/index.html');
const supervisor = read('edge/supervisor/supervisor.js');
const installer = read('edge/supervisor/install-windows.ps1');
const routes = read('src/modules/edge/edge.routes.js');
const service = read('src/modules/edge/edge-workspace.service.js');
const schema = read('prisma/edge-workspace-v1.prisma');
const restaurantHtml = read('src/web/restaurant.html');
const panelEntry = read('src/web/panel-restaurant-entry.js');
const app = read('src/app.js');
const version = JSON.parse(read('edge/version.json'));

for (const file of ['edge/agent/workspace-entry.js','edge/agent/workspace-entry-v28.js','edge/agent/workspace-entry-v59.js','edge/agent/workspace-entry-local-first-p0.js','edge/agent/restaurant-entry-v2.js','src/modules/edge/edge-workspace.service.js','src/web/panel-restaurant-entry.js','src/web/restaurant-control-center.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

assert.match(version.version, /^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/);
assert.equal(version.channel, 'PILOT');
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

// V28 remains the historical redirect guard source; V59 carries the same guard
// forward while adding only the PC Mesero surface patch. Local First P0 wraps V59
// without replacing that behavior.
assert.match(workspaceV28, /return true;\\n}`/);
assert.match(workspaceV28, /VANTIX_EDGE_WORKSPACE_V28_REDIRECT_PATCH/);
assert.match(workspaceV28, /patched\._compile\(source, target\)/);
assert.match(workspaceV59, /const originalRedirect/);
assert.match(workspaceV59, /const fixedRedirect/);
assert.match(workspaceV59, /res\.end\(\);\\n  return true;/);
assert.match(workspaceV59, /VANTIX_EDGE_WORKSPACE_PC_WAITER_V59/);
assert.match(workspaceV59, /patched\._compile\(source, target\)/);
assert.match(localFirstP0, /require\('\.\/workspace-entry-v59'\)/);
assert.match(localFirstP0, /30 \* 24 \* 60 \* 60 \* 1000/);
assert.match(restaurantEntry, /require\('\.\/workspace-entry-(?:v59|local-first-p0)'\)/);
assert.doesNotMatch(restaurantEntry, /require\('\.\/workspace-entry-v28'\)/);
assert.doesNotMatch(restaurantEntry, /require\('\.\/workspace-entry'\);/);

assert.match(workspaceHtml, /Centro de Control/);
assert.match(workspaceHtml, /LOCAL \+ NUBE/);
assert.match(workspaceHtml, /LOCAL · SIN INTERNET/);
assert.doesNotMatch(workspaceHtml, /emergencia/i);
assert.match(supervisor, /workspace-entry\.js/);
assert.match(installer, /VantixGC Restaurantes\.url/);
assert.match(installer, /app\/centro-de-control/);

assert.match(workspace, /if \(!readSession\(req\)\) return redirect\(res, '\/'\)/);
assert.match(workspaceV59, /source = source\.replace\(originalRedirect, fixedRedirect\)/);

assert.match(restaurantHtml, /Trabajar en sede/);
assert.match(restaurantHtml, /local-access-grant/);
assert.match(restaurantHtml, /restaurant-control-center\.css/);
assert.match(restaurantHtml, /restaurant-control-center\.js/);
assert.match(app, /const restaurantHtmlPath/);
assert.match(app, /app\.get\('\/app\/centro-de-control'/);
assert.match(app, /X-VantixGC-Vertical', 'RESTAURANT'/);
assert.match(app, /app\.get\('\/app\/restaurant-theme\.css'/);
assert.match(app, /app\.get\('\/app\/restaurant-ui\.js'/);
assert.match(app, /app\.get\('\/app\/restaurant-control-center\.js'/);

assert.doesNotMatch(panelEntry, /local-access-grant/);
assert.doesNotMatch(panelEntry, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
assert.match(panelEntry, /CONTROL_CENTER_PATH/);
assert.match(app, /core-nav-v7/);
assert.doesNotMatch(app, /core-nav-v8-edge-workspace/);

console.log('EDGE WORKSPACE V1 + V28 GUARD + V59 PC WAITER + LOCAL FIRST P0 STATIC SMOKE OK');
