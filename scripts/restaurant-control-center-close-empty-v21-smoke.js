'use strict';

const fs = require('node:fs');

const service = fs.readFileSync('src/modules/restaurant/restaurant-table-live-detail-v67.service.js', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-table-live-detail-v67.routes.js', 'utf8');
const tables = fs.readFileSync('src/web/restaurant-v2-tables.js', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-tables.html', 'utf8');
const schema = fs.readFileSync('prisma/restaurant-phase2-v1.prisma', 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(service.includes("VANTIX_RESTAURANT_CONTROL_CENTER_CLOSE_EMPTY_V21"), 'falta marcador V21');
expect(service.includes('canCloseEmptyFromControlCenter'), 'falta permiso funcional de cierre vacío');
expect(service.includes('closeEmptyFromControlCenter'), 'falta servicio de cierre administrativo');
expect(service.includes("RESTAURANT_CONTROL_CENTER_EMPTY_CLOSE_HAS_PRODUCTS"), 'falta bloqueo por productos pedidos');
expect(service.includes("RESTAURANT_CONTROL_CENTER_EMPTY_CLOSE_HAS_FINANCIAL_ACTIVITY"), 'falta bloqueo por actividad financiera');
expect(service.includes("String(order.state || '').toUpperCase() !== 'BORRADOR'"), 'falta bloqueo por pedidos enviados');
expect(service.includes('tx.restaurantTableSession.delete'), 'falta descarte de visita vacía');
expect(service.includes("data: { state: 'LIBRE' }"), 'falta retorno de mesa a LIBRE');
expect(service.includes('activeQrDevices'), 'falta control de autorizaciones QR');
expect(schema.includes('RestaurantQrVisitDevice') && schema.includes('onDelete: Cascade'), 'el contrato QR no confirma invalidación por borrado de sesión');

expect(routes.includes("'/mesas/:id/cerrar-vacia-v21'"), 'falta endpoint V21');
expect(routes.includes("requirePermission('MESAS.EDITAR')"), 'falta permiso MESAS.EDITAR');
expect(routes.includes('service.closeEmptyFromControlCenter'), 'endpoint no usa el servicio V21');

expect(tables.includes('CERRAR MESA VACÍA'), 'falta botón de Centro de control');
expect(tables.includes('/cerrar-vacia-v21'), 'UI no consume endpoint V21');
expect(tables.includes('No tiene productos pedidos'), 'falta confirmación explícita de mesa vacía');
expect(tables.includes('No se generó cobro, venta ni movimiento de inventario.'), 'falta confirmación operativa final');
expect(html.includes('restaurant-v2-tables.js?v=v21'), 'falta cache bust V21');

console.log('Restaurant Control Center Close Empty V21 smoke: OK');
