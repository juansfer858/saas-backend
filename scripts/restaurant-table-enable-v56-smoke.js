'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const baseUi = fs.readFileSync(path.join(root, 'src/web/restaurant-qr-ui.js'), 'utf8');
const routerSource = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant.public.routes.js'), 'utf8');
const v55 = require('../src/modules/restaurant/restaurant-table-enable-v55.public.routes');
const v56 = require('../src/modules/restaurant/restaurant-table-enable-v56.public.routes');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const patched = v56.patchQrSource(baseUi);

assert(patched.includes('VANTIX_RESTAURANT_TABLE_ENABLE_V56'), 'Falta marker V56 en QR');
assert(patched.includes("menuWhileClosed:true"), 'V56 no declara carta disponible con mesa libre');
assert(patched.includes("cartWhileClosed:true"), 'V56 no declara carrito disponible con mesa libre');
assert(patched.includes("requestOnlyOnConfirm:true"), 'V56 no limita la solicitud al confirmar pedido');
assert(!patched.includes("if (!wrap || !nav || !S.ctx?.open) return;"), 'La navegación sigue bloqueada por mesa cerrada');
assert(!patched.includes("if (!bar || !S.ctx?.open) {"), 'El carrito sigue bloqueado por mesa cerrada');
assert(!patched.includes('Esta mesa todavía no está abierta. Pídele al mesero que la abra y luego vuelve a intentar.'), 'La carta sigue reemplazada por pantalla cerrada');
assert(patched.includes('LA MESA SE HABILITA AL ENVIAR'), 'Falta explicación correcta al cliente');
assert(patched.includes("function isOrder(input,init){return method(input,init)==='POST'&&target(input).includes(prefix+'/pedidos');}"), 'El gate no está atado al envío final');
assert(patched.includes("requestEnable(){return api(prefix+'/habilitacion-mesa'"), 'Falta solicitud de habilitación');
assert(patched.includes("await ensureTableOpen();\n      await directAuthorize();"), 'No continúa automáticamente luego de habilitar');
assert(patched.includes("localStorage.setItem(storageKey,body.data.visitToken)"), 'No conserva autorización sin PIN tras habilitar');
assert(typeof v55.staffEnableRuntimeV55 === 'string' && v55.staffEnableRuntimeV55.includes('HABILITAR '), 'Runtime de personal no disponible');
assert(v56.patchQrSource(patched) === patched, 'Patch V56 no es idempotente');

const v56Mount = routerSource.indexOf('router.use(installRestaurantTableEnableV56);');
const menuRouter = routerSource.indexOf('router.use(restaurantMenuSurfaceSyncPublicRouter);');
const presenceRouter = routerSource.indexOf('router.use(restaurantQrPresenceRealtimePublicRouter);');
const waiterRouter = routerSource.indexOf('router.use(restaurantWaiterDevicePersistencePublicRouter);');
assert(v56Mount >= 0, 'V56 no está montado');
assert(v56Mount < menuRouter && v56Mount < presenceRouter && v56Mount < waiterRouter, 'V56 debe envolver assets antes de routers que los responden');

console.log(JSON.stringify({
  ok:true,
  marker:v56.MARKER,
  semantics:'SCAN_MENU_CART_CONFIRM_ENABLE_AUTO_SEND',
  qrAvailableWhileTableFree:true,
  staffApprovalOnlyOnFinalConfirm:true,
  pinRequired:false
}, null, 2));
