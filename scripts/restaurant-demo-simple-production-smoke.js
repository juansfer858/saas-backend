'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runtimePath = path.join(root, 'src', 'web', 'restaurant-v2-kds-simple-demo-v1.js');
const htmlPath = path.join(root, 'src', 'web', 'restaurant-v2-kds.html');
const publicRoutesPath = path.join(root, 'src', 'modules', 'restaurant', 'restaurant-v2-kds.public.routes.js');
const kdsServicePath = path.join(root, 'src', 'modules', 'restaurant', 'restaurant-v2-kds.service.js');

const runtime = fs.readFileSync(runtimePath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const publicRoutes = fs.readFileSync(publicRoutesPath, 'utf8');
const kdsService = fs.readFileSync(kdsServicePath, 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(runtime.includes("const TENANT='demo-restaurante';"), 'tenant guard missing');
expect(runtime.includes("!==TENANT)return;"), 'runtime must no-op for every other tenant');
expect(runtime.includes("data.kdsSimpleDemo") || runtime.includes("dataset.kdsSimpleDemo"), 'simple UI marker missing');
expect(runtime.includes("state:'EN_PREPARACION'"), 'pending -> preparing internal transition missing');
expect(runtime.includes("state:'LISTA'"), 'preparing -> ready internal transition missing');
expect(runtime.includes("state:'ENTREGADA'"), 'ready -> delivered compatibility transition missing');
expect(runtime.includes("textContent='✓ LISTO'"), 'simple one-touch ready action missing');
expect(runtime.includes("Por preparar"), 'simple pending label missing');
expect(runtime.includes("Listos para recoger"), 'simple ready label missing');
expect(html.includes('/app/restaurant-v2-kds-simple-demo-v1.js?v=v1'), 'KDS does not load demo runtime');
expect(publicRoutes.includes("router.get('/app/restaurant-v2-kds-simple-demo-v1.js'"), 'demo runtime public asset route missing');
expect(kdsService.includes("const DEMO_TENANT = 'demo-restaurante';"), 'demo tenant station bootstrap guard missing');
expect(kdsService.includes("name:'Cocina'"), 'default Cocina station missing');
expect(kdsService.includes("name:'Barra'"), 'default Barra station missing');
expect(kdsService.includes("name:'Postres'"), 'default Postres station missing');
expect(kdsService.includes('const existing = await prisma.restaurantProductionStation.count'), 'one-time bootstrap station count missing');
expect(kdsService.includes('if (existing > 0) return false;'), 'deleted stations could be recreated unexpectedly');
expect(runtime.includes("configured!=='Sin KDS configurado'"), 'unconfigured deleted station cards must be hidden');
expect(runtime.includes("⚙ Administrar estaciones"), 'station administration action missing');

const globalFiles = [
  'src/modules/restaurant/restaurant-v2-kds.routes.js',
  'src/modules/restaurant/restaurant-v2-kds.service.js',
  'src/modules/restaurant/restaurant.service.js'
];
for (const rel of globalFiles) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  expect(!source.includes('DEMO_RESTAURANTE_PRODUCTION_SIMPLE'), rel + ' must remain canonical');
}

console.log('DEMO_RESTAURANTE_SIMPLE_PRODUCTION=PASS');
console.log('OTHER_TENANTS_CANONICAL_KDS=PASS');
console.log('BACKEND_STATE_MACHINE_UNCHANGED=PASS');
console.log('DEMO_DEFAULT_EDITABLE_STATIONS=COCINA,BARRA,POSTRES');
console.log('DELETED_STATIONS_DO_NOT_RESEED=PASS');
