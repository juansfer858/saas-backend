const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) throw new Error(`No se encontró marcador: ${label}`);
  return content.replace(search, replacement);
}
function replaceRange(content, start, end, replacement, label) {
  const a = content.indexOf(start);
  const b = content.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || b <= a) throw new Error(`No se encontró rango: ${label}`);
  return content.slice(0, a) + replacement + '\n\n  ' + content.slice(b);
}

// 1. Rutas: las nuevas acciones pertenecen al identity service, no al service legado.
{
  const path = 'src/modules/restaurant/restaurant.routes.js';
  let src = read(path);
  src = src.replace('await service.prepareAccount(req.tenantId, req.user, req.params.id)', 'await identity.prepareAccount(req.tenantId, req.user, req.params.id)');
  src = src.replace('await service.sendAccountToCash(req.tenantId, req.user, req.params.id)', 'await identity.sendAccountToCash(req.tenantId, req.user, req.params.id)');
  write(path, src);
}

// 2. Apertura de mesa: persistir el modo de cuenta desde el primer momento.
{
  const path = 'src/modules/restaurant/restaurant.service.js';
  let src = read(path);
  if (!src.includes("billingMode: input.billingMode === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'CONJUNTA'")) {
    src = replaceOnce(
      src,
      '        openedByUserId: user.id,\n        guestCount: Math.max(Number(input.guestCount) || 1, 1),',
      "        openedByUserId: user.id,\n        billingMode: input.billingMode === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'CONJUNTA',\n        guestCount: Math.max(Number(input.guestCount) || 1, 1),",
      'billingMode en openTable'
    );
  }
  write(path, src);
}

// 3. Mesero V2 dentro del propietario canónico restaurant-ui.js.
{
  const path = 'src/web/restaurant-ui.js';
  let src = read(path);
  if (!src.includes('waiterSeat: 1')) {
    src = replaceOnce(
      src,
      '    selectedTableId: null,\n    draft: null,',
      "    selectedTableId: null,\n    waiterSeat: 1,\n    waiterCategory: 'ENTRADAS',\n    waiterSearch: '',\n    draft: null,",
      'estado Mesero V2'
    );
  }
  src = replaceOnce(
    src,
    "  function draftQty(menuItemId) {\n    const item = S.draft?.order?.items?.find((x) => x.menuItemId === menuItemId);\n    return Number(item?.quantity || 0);\n  }",
    "  function draftQty(menuItemId, seatNumber = null) {\n    const mode = S.draft?.service?.billingMode || S.draft?.session?.billingMode || 'CONJUNTA';\n    const targetSeat = mode === 'INDIVIDUAL' ? Number(seatNumber || S.waiterSeat || 1) : null;\n    const item = S.draft?.order?.items?.find((x) => x.menuItemId === menuItemId && (mode !== 'INDIVIDUAL' ? x.seatNumber == null : Number(x.seatNumber || 0) === targetSeat));\n    return Number(item?.quantity || 0);\n  }",
    'draftQty por persona'
  );
  const block = read('scripts/.waiter-v2-render-block.txt').trimEnd();
  src = replaceRange(src, '  async function renderWaiter() {', 'function commandItems(command)', block, 'renderWaiter V2');
  write(path, src);
}

// 4. Estilos del Mesero V2 en el CSS canónico del Centro de Control.
{
  const path = 'src/web/restaurant-control-center.css';
  let src = read(path);
  const block = read('scripts/.waiter-v2-css-block.txt');
  if (!src.includes('/* Mesero V2 — zona, mesa, personas, pedido y cuenta en un solo flujo canónico. */')) src += block;
  write(path, src);
}

// 5. Cache keys nuevas para impedir que el navegador conserve la pantalla anterior.
{
  const path = 'src/web/restaurant.html';
  let src = read(path);
  src = src.replace('/app/restaurant-control-center.css?v=workspace-v5', '/app/restaurant-control-center.css?v=workspace-v6');
  src = src.replace('/app/restaurant-ui.js?v=zones-v1', '/app/restaurant-ui.js?v=waiter-v2');
  write(path, src);
}

// 6. Smoke UI existente: validar la arquitectura nueva y retirar expectativas de la pantalla anterior.
{
  const path = 'scripts/restaurant-control-center-operational-smoke.js';
  let src = read(path);
  src = src.replaceAll('restaurant-control-center\\.css\\?v=workspace-v5', 'restaurant-control-center\\.css\\?v=workspace-v6');
  src = src.replaceAll('restaurant-ui\\.js\\?v=zones-v1', 'restaurant-ui\\.js\\?v=waiter-v2');
  const start = '  // Waiter continuity:';
  const end = '  new Function(shellJs);';
  const block = [
    '  // Mesero V2: zona, mesa, cuenta conjunta/individual, personas y envío explícito a Caja.',
    '  for (const token of [',
    "    'waiterSeat: 1',",
    "    'Panel del mesero',",
    "    'data-waiter-table',",
    "    'data-billing-mode=\\\"CONJUNTA\\\"',",
    "    'data-billing-mode=\\\"INDIVIDUAL\\\"',",
    "    '+ Agregar persona',",
    "    'data-waiter-seat',",
    "    'data-waiter-move',",
    "    'data-waiter-note',",
    "    'Enviar a cocina / barra',",
    "    'Preparar cuenta',",
    "    'Enviar a caja',",
    "    'Imprimir pre-cuenta',",
    "    '/servicio',",
    "    '/items/',",
    "    '/preparar-cuenta',",
    "    '/enviar-caja',",
    "    'waiterPrecheckHtml',",
    "    'waiterProgressMarkup'",
    '  ]) assert.ok(operationalEngine.includes(token), `Mesero V2 must contain ${token}`);',
    '  assert.match(shellCss, /\\/\\* Mesero V2 — zona, mesa, personas, pedido y cuenta en un solo flujo canónico\\. \\*\\//);',
    '  assert.match(shellCss, /\\.waiter-workspace\\{[^}]*grid-template-columns:minmax\\(0,1\\.55fr\\) minmax\\(390px,\\.85fr\\)/);',
    '  assert.match(shellCss, /@media\\(max-width:780px\\)[\\s\\S]*?\\.waiter-workspace\\{grid-template-columns:1fr\\}/);',
    '',
    ''
  ].join('\n');
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('No se encontró bloque waiter del smoke UI');
  src = src.slice(0, a) + block + src.slice(b);
  write(path, src);
}

// 7. Añadir el smoke PostgreSQL a Super Core CI inmediatamente después de Zonas.
{
  const path = '.github/workflows/super-core-ci.yml';
  let src = read(path);
  const marker = "      - name: Validate Restaurant zones and existing-table backfill against PostgreSQL\n        run: node scripts/restaurant-zones-smoke.js\n";
  const step = "\n      - name: Validate Restaurant Waiter V2 persons and billing workflow against PostgreSQL\n        run: node scripts/restaurant-waiter-v2-smoke.js\n";
  if (!src.includes('Validate Restaurant Waiter V2 persons and billing workflow against PostgreSQL')) {
    src = replaceOnce(src, marker, marker + step, 'paso CI Mesero V2');
  }
  write(path, src);
}

// 8. Retirar todos los artefactos temporales de aplicación del refactor antes del commit final.
for (const path of [
  'scripts/.waiter-v2-render-block.txt',
  'scripts/.waiter-v2-css-block.txt',
  'scripts/apply-waiter-v2-refactor.js',
  '.github/workflows/waiter-v2-refactor.yml'
]) {
  try { fs.unlinkSync(path); } catch {}
}

console.log('WAITER_V2_REFACTOR_APPLIED');
