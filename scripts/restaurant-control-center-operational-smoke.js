const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

async function main() {
  const routes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
  const appSource = fs.readFileSync('src/app.js', 'utf8');
  const panelEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
  const shellJs = fs.readFileSync('src/web/restaurant-control-center.js', 'utf8');
  const shellCss = fs.readFileSync('src/web/restaurant-control-center.css', 'utf8');
  const restaurantHtml = fs.readFileSync('src/web/restaurant.html', 'utf8');
  const operationalEngine = fs.readFileSync('src/web/restaurant-ui.js', 'utf8');

  assert.match(routes, /\/app\/centro-de-control/);
  assert.match(routes, /operational-shell-v1/);
  assert.match(routes, /restaurant-ui-v1/);
  assert.match(routes, /restaurant-control-center\.css/);
  assert.match(routes, /restaurant-control-center\.js/);

  assert.match(panelEntry, /CONTROL_CENTER_PATH = '\/app\/centro-de-control'/);
  assert.ok(!panelEntry.includes('CLASSIC_RESTAURANT_PATH'));
  assert.ok(!panelEntry.includes('Panel clásico'));
  assert.ok(!panelEntry.includes('openRestaurantClassic'));

  assert.match(appSource, /href: '\/app\/centro-de-control',[\s\S]*?label: 'Restaurante',[\s\S]*?primaryVertical: true/);
  assert.match(appSource, /subtitle: 'Operación principal'/);
  assert.match(appSource, /restaurantApp: '\/app\/centro-de-control'/);
  assert.match(appSource, /app\.get\('\/app\/restaurante',[\s\S]*?res\.redirect\(302, '\/app\/centro-de-control'\)/);
  assert.ok(!appSource.includes("href: '/app/restaurante'"));

  // Restaurant exposes one large persistent return directly below the operational rail.
  assert.match(restaurantHtml, /data-restaurant-admin-link="true"/);
  assert.match(restaurantHtml, /href="\/app\/dashboard"[^>]*data-restaurant-admin-link="true"[^>]*>← Volver a Administración<\/a>/);
  assert.ok(!/data-restaurant-admin-link="true"[^>]*style=/.test(restaurantHtml), 'Admin return styling must live in the canonical Restaurant CSS, not inline');
  assert.match(restaurantHtml, /restaurant-control-center\.css\?v=workspace-v3/);
  assert.match(restaurantHtml, /restaurant-control-center\.js\?v=workspace-v3/);
  assert.match(restaurantHtml, /admin\.textContent='← Volver a Administración'/);
  assert.match(shellCss, /\.cc-classic-link\{position:static!important;display:flex!important;[\s\S]*?min-height:56px!important/);
  assert.match(shellCss, /\.cc-classic-link:hover\{background:#fff7ed!important/);
  assert.match(shellCss, /@media\(max-width:780px\)[\s\S]*?\.cc-classic-link\{display:flex!important/);
  assert.ok(!shellCss.includes('.rail-wrap:before,.rail-wrap:after,.cc-classic-link{display:none!important}'), 'Admin return must remain visible on mobile');

  assert.match(shellJs, /data-cc-home/);
  assert.match(shellJs, /openOperationalTab/);
  assert.match(shellJs, /data-tab/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/ui-context/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/mesas/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/menu/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/comandas/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/pedidos/);
  assert.ok(!shellJs.includes("location.href='/app/restaurante'"), 'Operational shell must not redirect normal actions to legacy UI');
  assert.ok(!shellJs.includes('Panel clásico de respaldo'), 'The control center must not recreate obsolete legacy navigation');
  assert.ok(!shellJs.includes("classic.href = '/app/restaurante'"), 'Administration return has one canonical owner in restaurant.html');
  assert.match(shellCss, /\.rail-wrap/);
  assert.match(shellCss, /\.cc-dashboard/);

  // Dashboard primary actions must remain readable; Caja is intentionally the strongest CTA.
  assert.match(shellJs, /<button class="cc-action cash" data-cc-tab="caja"><span class="cc-cash-icon">▣<\/span><strong>Caja<\/strong><small>Cobrar \/ Cerrar<\/small><\/button>/);
  assert.match(shellCss, /\.cc-action\{[^}]*font-size:14px;[^}]*line-height:1\.25/);
  assert.match(shellCss, /\.cc-action\.cash\{[^}]*font-size:22px/);
  assert.match(shellCss, /\.cc-action\.cash small\{[^}]*font-size:15px;[^}]*font-weight:950/);
  assert.ok(!shellCss.includes('.cc-action.cash small{display:block;margin-top:7px;font-size:10px}'), 'Caja label must never regress to the old 10px size');

  // Every internal Dashboard destination has a deterministic back control that returns to its real origin.
  for (const token of [
    "dashboard:'Centro de control'",
    "salon:'Mesas'",
    "mesero:'Mesero'",
    "pedidos:'Pedidos en curso'",
    "kds:'Cocina / Barra'",
    "caja:'Caja'",
    "carta:'Carta y productos'",
    "estado:'Tema / Estado'",
    'function currentView()',
    'function enterView(view, pushState = true)',
    'function navigateBack()',
    'function renderBackControl',
    'ccTrail',
    'ccBackBar',
    'data-cc-back="true"',
    '← Atrás',
    'routeCurrentView',
    'history.replaceState'
  ]) assert.ok(shellJs.includes(token), `Restaurant origin-aware back must contain ${token}`);
  assert.ok(!shellJs.includes('history.back('), 'Restaurant internal back must be deterministic, not browser-history dependent');
  assert.ok(!shellJs.includes('customBack()'), 'Custom screens must use the same canonical back control as operational screens');

  // The Centro de Control must close the operational gap between sending an order and charging it.
  for (const token of [
    'Pedidos en curso',
    'Flujo del servicio',
    '1 · Mesas abiertas',
    '2 · Pedidos activos',
    '3 · Por preparar',
    '4 · En preparación',
    '5 · Listos',
    '6 · Cuenta pedida',
    'Listo para entregar',
    'Entregados recientes',
    'data-cc-orders="true"',
    'data-cc-order-filter',
    'data-cc-order-mesero',
    'data-cc-order-kds',
    'data-cc-order-cash',
    "view === 'pedidos'",
    "showOrders: () => showOrders(true)"
  ]) assert.ok(shellJs.includes(token), `Restaurant service flow must contain ${token}`);

  // Control-center navigation no longer watches and mutates the rail through a DOM observer.
  assert.ok(!shellJs.includes('MutationObserver'));
  assert.ok(shellJs.includes("document.addEventListener('click'"));
  assert.ok(shellJs.includes('requestAnimationFrame(() => {'));

  // The operational shell continues to reuse the already validated write engine.
  assert.match(operationalEngine, /method:'POST'/);
  assert.match(operationalEngine, /method:'PUT'/);
  assert.match(operationalEngine, /method:'PATCH'/);

  // Waiter continuity: previous rounds stay visible, kitchen state refreshes without repainting the full waiter screen,
  // and requesting the bill is blocked while an unsent round exists.
  for (const token of [
    'loadSessionOrders',
    '/api/v1/restaurante/pedidos?sessionId=',
    'Servicio de esta mesa',
    'Nueva ronda',
    'Ronda ${sentOrders.length + 1}',
    'Listo para entregar',
    'Parcialmente listo',
    'waiterHistory',
    'refreshWaiterHistory',
    'No puedes pedir la cuenta con productos sin enviar',
    'Pedir cuenta · ronda sin enviar',
    'La cuenta de esta mesa ya fue solicitada',
    'La mesa volvió a servicio activo'
  ]) assert.ok(operationalEngine.includes(token), `Waiter continuity must contain ${token}`);
  assert.match(operationalEngine, /S\.poll = setInterval\([\s\S]*refreshWaiterHistory/);
  assert.match(operationalEngine, /table\.state === 'CUENTA_PEDIDA'/);

  new Function(shellJs);
  new Function(operationalEngine);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const control = await fetch(base + '/app/centro-de-control');
    const body = await control.text();
    assert.equal(control.status, 200);
    assert.equal(control.headers.get('x-vantixgc-restaurant-control'), 'operational-shell-v1');
    assert.equal(control.headers.get('x-vantixgc-restaurant-control-engine'), 'restaurant-ui-v1');
    assert.match(body, /restaurant-theme\.js/);
    assert.match(body, /restaurant-ui\.js/);
    assert.match(body, /restaurant-control-center\.css\?v=workspace-v3/);
    assert.match(body, /restaurant-control-center\.js\?v=workspace-v3/);
    assert.match(body, /data-restaurant-admin-link="true"/);
    assert.match(body, /← Volver a Administración/);

    const legacy = await fetch(base + '/app/restaurante', { redirect:'manual' });
    assert.equal(legacy.status, 302);
    assert.equal(legacy.headers.get('location'), '/app/centro-de-control');
    assert.equal(legacy.headers.get('x-vantixgc-restaurant-canonical'), '/app/centro-de-control');

    for (const route of ['/app/dashboard', '/app/inventario']) {
      const response = await fetch(base + route);
      const html = await response.text();
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('x-vantixgc-super-core-theme'), 'super-core-v5-silver-server');
      assert.match(html, /href="\/app\/centro-de-control"[^>]*data-restaurant-entry="true"[^>]*data-core-vertical-primary="true"/);
      assert.match(html, /<strong>Restaurante<\/strong><small>Operación principal<\/small>/);
      assert.ok(!/href="\/app\/restaurante"[^>]*data-restaurant-entry="true"/.test(html), `${route}: sidebar must not point to legacy Restaurant`);
    }

    const root = await fetch(base + '/');
    const rootBody = await root.json();
    assert.equal(rootBody.restaurantApp, '/app/centro-de-control');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('RESTAURANT CONTROL CENTER + ORIGIN-AWARE INTERNAL BACK + READABLE CASH CTA SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
