'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

async function main() {
  const appSource = fs.readFileSync('src/app.js', 'utf8');
  const panelEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
  const legacyHtml = fs.readFileSync('src/web/restaurant.html', 'utf8');
  const legacyShell = fs.readFileSync('src/web/restaurant-control-center.js', 'utf8');
  const legacyCss = fs.readFileSync('src/web/restaurant-control-center.css', 'utf8');
  const legacyEngine = fs.readFileSync('src/web/restaurant-ui.js', 'utf8');
  const p11Public = fs.readFileSync('src/modules/restaurant/restaurant-v1-retirement-p11.public.routes.js', 'utf8');
  const p10Public = fs.readFileSync('src/modules/restaurant/restaurant-v2-control-center.public.routes.js', 'utf8');
  const p11Launcher = fs.readFileSync('src/web/restaurant-v1-retirement-p11-launch.js', 'utf8');
  const p11Native = fs.readFileSync('src/web/restaurant-v2-native-control-p11.js', 'utf8');

  // Global Restaurant entry remains stable; P11 owns the tenant-aware decision behind it.
  assert.match(panelEntry, /CONTROL_CENTER_PATH = '\/app\/centro-de-control'/);
  assert.match(appSource, /href: '\/app\/centro-de-control',[\s\S]*?label: 'Restaurante',[\s\S]*?primaryVertical: true/);
  assert.match(appSource, /restaurantApp: '\/app\/centro-de-control'/);
  assert.match(appSource, /app\.get\('\/app\/restaurante',[\s\S]*?res\.redirect\(302, '\/app\/centro-de-control'\)/);

  // P11 canonical Control Center is native/tenant-aware and cannot load V1 engine.
  assert.match(p11Public, /router\.get\('\/app\/centro-de-control'/);
  assert.match(p11Public, /\/app\/centro-de-control-v2/);
  assert.match(p11Launcher, /VANTIX_RESTAURANT_V1_RETIREMENT_LAUNCH_P11/);
  assert.match(p11Launcher, /\/api\/v1\/restaurante\/v2\/retiro-v1\/launch/);
  assert.match(p11Native, /VANTIX_RESTAURANT_V2_NATIVE_CONTROL_P11/);
  assert.match(p11Native, /\/app\/restaurante-v2\/mesas/);
  assert.match(p11Native, /\/app\/restaurante-v2\/pedidos/);
  assert.match(p11Native, /\/app\/restaurante-v2\/kds/);
  assert.match(p11Native, /\/app\/restaurante-v2\/caja/);
  assert.doesNotMatch(p11Launcher, /MutationObserver|setInterval|restaurant-ui\.js/);
  assert.doesNotMatch(p11Native, /MutationObserver|setInterval|restaurant-ui\.js|restaurant-control-center\.js/);

  // P10 compatibility remains explicit for rollback/migration and still owns the
  // previous operational shell contracts while V1 code is retained.
  assert.match(p10Public, /\/app\/centro-de-control-p10/);
  assert.match(p10Public, /restaurant-ui-v1/);
  assert.match(legacyHtml, /restaurant-ui\.js\?v=salon-qr-v2/);
  assert.match(legacyHtml, /restaurant-control-center\.js\?v=workspace-v3-nav2/);
  assert.match(legacyShell, /openOperationalTab/);
  assert.match(legacyShell, /data-cc-home/);
  assert.doesNotMatch(legacyShell, /MutationObserver/);
  assert.match(legacyCss, /\.rail-wrap/);
  assert.match(legacyCss, /\.cc-dashboard/);

  // Keep high-value legacy fallback contracts protected until P12 deletes them.
  for (const token of [
    'Caja lista para comenzar', 'CAJA CERRADA', 'CAJA ABIERTA', 'Confirmar cobro', 'Cerrar turno',
    'Gestionar zonas', 'Gestionar QR', 'Editar plano', 'openQrManager',
    'KDS_OVERDUE_MINUTES = 12', 'Marcar listo', 'Mesero avisado en vivo',
    'Panel del mesero', '+ Agregar persona', 'Enviar a cocina / barra', 'Preparar cuenta', 'Enviar a caja'
  ]) assert.ok(legacyEngine.includes(token), `P10/V1 compatibility must retain ${token}`);

  new Function(p11Launcher);
  new Function(p11Native);
  new Function(legacyShell);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const canonical = await fetch(base + '/app/centro-de-control');
    const canonicalBody = await canonical.text();
    assert.equal(canonical.status, 200);
    assert.equal(canonical.headers.get('x-vantixgc-restaurant-v1-retirement'), 'p11-v1-retirement');
    assert.match(canonicalBody, /data-p11-launch="true"/);
    assert.doesNotMatch(canonicalBody, /restaurant-ui\.js|restaurant-control-center\.js|MutationObserver/);

    const native = await fetch(base + '/app/centro-de-control-v2');
    const nativeBody = await native.text();
    assert.equal(native.status, 200);
    assert.equal(native.headers.get('x-vantixgc-restaurant-v1-retirement'), 'p11-v1-retirement');
    assert.match(nativeBody, /data-v2-native-control="p11"/);
    assert.doesNotMatch(nativeBody, /restaurant-ui\.js|restaurant-control-center\.js|MutationObserver/);

    const compat = await fetch(base + '/app/centro-de-control-p10');
    const compatBody = await compat.text();
    assert.equal(compat.status, 200);
    assert.equal(compat.headers.get('x-vantixgc-restaurant-control'), 'operational-shell-v1');
    assert.equal(compat.headers.get('x-vantixgc-restaurant-control-engine'), 'restaurant-ui-v1');
    assert.equal(compat.headers.get('x-vantixgc-restaurant-control-p10-compatibility'), 'true');
    assert.match(compatBody, /restaurant-theme\.js/);
    assert.match(compatBody, /restaurant-ui\.js\?v=salon-qr-v2/);
    assert.match(compatBody, /restaurant-v2-control-center-bridge\.js/);

    const legacyEntry = await fetch(base + '/app/restaurante', { redirect:'manual' });
    assert.equal(legacyEntry.status, 302);
    assert.equal(legacyEntry.headers.get('location'), '/app/centro-de-control');
    assert.equal(legacyEntry.headers.get('x-vantixgc-restaurant-canonical'), '/app/centro-de-control');

    for (const route of ['/app/dashboard', '/app/inventario']) {
      const response = await fetch(base + route);
      const html = await response.text();
      assert.equal(response.status, 200, route);
      assert.match(html, /href="\/app\/centro-de-control"[^>]*data-restaurant-entry="true"[^>]*data-core-vertical-primary="true"/);
    }

    const root = await fetch(base + '/');
    const rootBody = await root.json();
    assert.equal(rootBody.restaurantApp, '/app/centro-de-control');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('RESTAURANT CONTROL CENTER P11 CANONICAL + P10 COMPATIBILITY + V1 TECHNICAL FALLBACK SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
