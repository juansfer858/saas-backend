'use strict';

const fs = require('node:fs');

const service = fs.readFileSync('src/modules/restaurant/restaurant-table-live-detail-v67.service.js', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-table-live-detail-v67.routes.js', 'utf8');
const tables = fs.readFileSync('src/web/restaurant-v2-tables.js', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-tables.html', 'utf8');
const css = fs.readFileSync('src/web/restaurant-v2-tables.css', 'utf8');
const identity = fs.readFileSync('src/modules/restaurant/restaurant-identity.service.js', 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(service.includes("CONTROL_CENTER_ROLES = new Set(['ADMIN', 'SUPER_ADMIN'])"), 'el retiro administrativo no está limitado a Centro de control');
expect(service.includes('async function removeDraftItemFromControlCenter'), 'falta operación de retiro administrativo');
expect(service.includes("String(order.state || '').toUpperCase() !== 'BORRADOR'"), 'se podría retirar una línea ya enviada');
expect(service.includes('RESTAURANT_CONTROL_CENTER_ITEM_ALREADY_SENT'), 'falta bloqueo explícito para líneas enviadas');
expect(service.includes('restaurantOrderItem.delete'), 'el retiro no elimina la línea del pedido');
expect(service.includes('detalleComprobante.delete'), 'el retiro no elimina el detalle comercial');
expect(service.includes('subtotal: { decrement: detail.subtotalLinea }'), 'el retiro no corrige subtotal');
expect(service.includes('ivaTotal: { decrement: detail.ivaValor }'), 'el retiro no corrige IVA');
expect(service.includes('impoconsumoTotal: { decrement: detail.impoconsumoValor }'), 'el retiro no corrige impoconsumo');
expect(service.includes('total: { decrement: detail.totalLinea }'), 'el retiro no corrige total');
expect(service.includes('menuItemId: item.menuItemId'), 'detalle de mesa perdió el vínculo al producto de menú');
expect(service.includes("canRemoveFromControlCenter: controlCenterDraftManager && state === 'POR_ENVIAR'"), 'la UI no recibe la frontera administrable exacta');

expect(routes.includes("'/mesas/:id/borrador/items/:itemId/retirar-v20'"), 'falta endpoint V20');
expect(routes.includes("requirePermission('MESAS.EDITAR')"), 'falta permiso de edición de mesa');
expect(routes.includes("requirePermission('PEDIDOS.CREAR')"), 'falta permiso de pedido para retirar');
expect(routes.includes('removeDraftItemFromControlCenter'), 'endpoint no usa el servicio seguro');

expect(tables.includes('VANTIX_RESTAURANT_CONTROL_CENTER_DRAFT_V20'), 'falta marker V20 en Mesas');
expect(tables.includes('data-remove-draft'), 'falta acción RETIRAR en la ficha de mesa');
expect(tables.includes('RETIRAR'), 'falta texto operativo de retiro');
expect(tables.includes('/borrador/items/${encodeURIComponent(itemId)}/retirar-v20'), 'la UI no llama el endpoint administrativo');
expect(tables.includes('todavía NO fue enviado a cocina/barra'), 'falta confirmación de frontera antes del retiro');
expect(tables.includes('Las líneas ya enviadas no se eliminan silenciosamente'), 'falta explicación de protección para líneas enviadas');
expect(html.includes('/app/restaurant-v2-tables.js?v=v'), 'Mesas no fuerza una versión del asset de tablas');
expect(html.includes('restaurant-v2-tables.css?v=v20'), 'Mesas no fuerza estilos V20');
expect(css.includes('.rv2-draft-admin'), 'falta señal visual de borradores administrables');
expect(css.includes('.rv2-draft-remove'), 'falta estilo de retiro');

expect(identity.includes('if (requestedQty.eq(0))'), 'se perdió el retiro normal del Mesero');
expect(identity.includes('restaurantOrderItem.delete'), 'el retiro normal del Mesero dejó de borrar su línea');

console.log('Restaurant Control Center Draft V20 smoke: OK');
