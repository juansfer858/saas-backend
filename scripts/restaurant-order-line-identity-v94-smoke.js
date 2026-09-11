'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  operationalLineKey,
  groupOperationalLines,
  sameOperationalLine
} = require('../src/modules/restaurant/restaurant-order-line-identity-v94');
const delivery = require('../src/modules/restaurant/restaurant-delivery.service');
const { itemSchema, presentDeliveryResponse } = require('../src/modules/restaurant/restaurant-delivery.routes');

function line(overrides = {}) {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    menuItemId: '11111111-1111-4111-8111-111111111111',
    productId: '22222222-2222-4222-8222-222222222222',
    description: 'Coca-Cola',
    quantity: 1,
    unitPrice: 5000,
    lineTotal: 5000,
    station: 'BARRA',
    orderState: 'ENVIADO',
    source: 'MESERO',
    seatNumber: 1,
    notes: null,
    ...overrides
  };
}

function main() {
  const twoPeople = groupOperationalLines([
    line({ id:'c1', seatNumber:1 }),
    line({ id:'c2', seatNumber:2 })
  ]);
  assert.equal(twoPeople.length, 1, 'Dos líneas idénticas de personas distintas deben agruparse');
  assert.equal(Number(twoPeople[0].quantity), 2);
  assert.deepEqual(twoPeople[0].seatNumbers, [1, 2]);
  assert.deepEqual(twoPeople[0].seatLabels, ['Persona 1', 'Persona 2']);

  const noteSensitive = groupOperationalLines([
    line({ id:'n1', seatNumber:1, notes:null }),
    line({ id:'n2', seatNumber:2, notes:null }),
    line({ id:'n3', seatNumber:3, notes:'CON HIELO' })
  ]);
  assert.equal(noteSensitive.length, 2, 'Una nota operacional diferente debe separar el grupo');
  const normal = noteSensitive.find((row) => !row.notes);
  const ice = noteSensitive.find((row) => row.notes === 'CON HIELO');
  assert.equal(Number(normal.quantity), 2);
  assert.deepEqual(normal.seatNumbers, [1, 2]);
  assert.equal(Number(ice.quantity), 1);
  assert.deepEqual(ice.seatNumbers, [3]);

  assert.equal(sameOperationalLine(
    line({ modifiers:{ queso:true, salsa:'BBQ' }, variant:'GRANDE' }),
    line({ modifiers:{ salsa:'BBQ', queso:true }, variant:'GRANDE', seatNumber:2 })
  ), true, 'Orden de modificadores no debe cambiar la identidad');
  assert.equal(sameOperationalLine(
    line({ modifiers:{ queso:true }, variant:'GRANDE' }),
    line({ modifiers:{ queso:false }, variant:'GRANDE' })
  ), false, 'Modificadores distintos deben separar');
  assert.equal(sameOperationalLine(line({ variant:'GRANDE' }), line({ variant:'MEDIANA' })), false, 'Variantes distintas deben separar');
  assert.equal(sameOperationalLine(line({ unitPrice:5000 }), line({ unitPrice:6000 })), false, 'Precio aplicado distinto debe separar');
  assert.equal(sameOperationalLine(line({ notes:'sin cebolla' }), line({ notes:'  SIN   CEBOLLA  ' })), true, 'Notas equivalentes normalizadas deben agrupar');

  const sourceSensitive = groupOperationalLines([
    line({ id:'s1', source:'MESERO', orderState:'ENVIADO' }),
    line({ id:'s2', source:'QR', orderState:'ENVIADO' })
  ]);
  assert.equal(sourceSensitive.length, 2, 'Pedidos de orígenes distintos no se deben mezclar en historial operativo');
  assert.notEqual(operationalLineKey(line({ orderState:'ENVIADO' })), operationalLineKey(line({ orderState:'LISTO' })), 'Estados distintos no se agrupan en el historial');

  const product = { precio1:20000, ivaPct:0, impoconsumoPct:0 };
  const priced = delivery.calculateLine(product, 2, 22000);
  assert.equal(priced.basePrice.toFixed(2), '20000.00');
  assert.equal(priced.price.toFixed(2), '22000.00');
  assert.equal(priced.total.toFixed(2), '44000.00');
  const zero = delivery.calculateLine(product, 1, 0);
  assert.equal(zero.price.toFixed(2), '0.00', 'Precio 0 sigue la regla vigente de Venta: válido; sólo negativos se rechazan');
  assert.throws(() => delivery.calculateLine(product, 1, -1), /precio aplicado no puede ser negativo/i);

  const menu = { id:'33333333-3333-4333-8333-333333333333', station:'COCINA' };
  const prepared = delivery.groupPreparedLines([
    { request:{ notes:null }, menu, product:{...product,id:'p1',nombre:'Hamburguesa'}, q:1, price:delivery.calculateLine(product,1,20000).price },
    { request:{ notes:null }, menu, product:{...product,id:'p1',nombre:'Hamburguesa'}, q:1, price:delivery.calculateLine(product,1,20000).price },
    { request:{ notes:'SIN CEBOLLA' }, menu, product:{...product,id:'p1',nombre:'Hamburguesa'}, q:1, price:delivery.calculateLine(product,1,20000).price },
    { request:{ notes:null }, menu, product:{...product,id:'p1',nombre:'Hamburguesa'}, q:1, price:delivery.calculateLine(product,1,22000).price }
  ].map((row) => ({ ...row, basePrice:delivery.calculateLine(row.product,1).basePrice, ivaPct:0, impoconsumoPct:0, subtotal:row.price, iva:0, impoconsumo:0, total:row.price })));
  assert.equal(prepared.length, 3, 'Domicilio debe separar por nota y precio aplicado');
  assert.ok(prepared.some((row) => Number(row.q) === 2 && row.price.toFixed(2) === '20000.00' && !row.request.notes));

  const validItem = itemSchema.parse({ menuItemId:menu.id, quantity:2, notes:'CON HIELO', appliedUnitPrice:6000 });
  assert.equal(validItem.appliedUnitPrice, 6000);
  assert.throws(() => itemSchema.parse({ menuItemId:menu.id, quantity:1, appliedUnitPrice:-1 }));

  const presented = presentDeliveryResponse({ id:'d1', items:[line({id:'r1'}),line({id:'r2',seatNumber:2})], operationalItems:twoPeople });
  assert.equal(presented.rawItems.length, 2, 'La respuesta debe conservar líneas crudas para trazabilidad');
  assert.equal(presented.items.length, 1, 'La superficie operacional debe usar grupos equivalentes');

  const ordersUi = fs.readFileSync(path.join(__dirname, '../src/web/restaurant-v2-orders.js'), 'utf8');
  assert.match(ordersUi, /VANTIX_RESTAURANT_ORDER_PEOPLE_GROUPS_V94/);
  assert.match(ordersUi, /service\?\.operationalItems/);
  assert.match(ordersUi, /Persona \$\{item\.seatNumber\}/);
  assert.match(ordersUi, /item\.notes/);

  const kdsUi = fs.readFileSync(path.join(__dirname, '../src/web/restaurant-v2-kds.js'), 'utf8');
  assert.match(kdsUi, /i\.seatNumber/);
  assert.match(kdsUi, /PERSONA/);

  const deliveryHost = fs.readFileSync(path.join(__dirname, '../src/web/restaurant-v2-delivery-p11.html'), 'utf8');
  assert.match(deliveryHost, /restaurant-delivery-orders-compact-v93\.js/);
  const deliveryEditor = fs.readFileSync(path.join(__dirname, '../src/web/restaurant-delivery-orders-compact-v93.js'), 'utf8');
  assert.match(deliveryEditor, /VANTIX_RESTAURANT_DELIVERY_LINE_PRICE_V94/);
  assert.match(deliveryEditor, /Precio Carta:/);
  assert.match(deliveryEditor, /data-v94-price/);
  assert.match(deliveryEditor, /data-v94-note/);
  assert.match(deliveryEditor, /appliedUnitPrice/);
  assert.match(deliveryEditor, /deliveryFeeDefault:0/);
  assert.match(deliveryEditor, /value=\"0\"/);

  const deliveryListUi = fs.readFileSync(path.join(__dirname, '../src/web/restaurant-delivery-ui.js'), 'utf8');
  assert.match(deliveryListUi, /item\.unitPrice/);
  assert.match(deliveryListUi, /item\.notes/);
  assert.match(deliveryListUi, /c\/u/);

  const forbidden = [
    'src/modules/restaurant/restaurant-v2-cash.service.js',
    'src/modules/restaurant/restaurant-v2-split.service.js',
    'src/modules/restaurant/restaurant-visit-payments.service.js',
    'src/modules/treasury/treasury.service.js',
    'src/modules/commercial/sales.service.js'
  ];
  for (const file of forbidden) assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `Contrato esperado faltante: ${file}`);

  console.log(JSON.stringify({
    ok:true,
    marker:'VANTIX_RESTAURANT_ORDER_LINE_IDENTITY_V94',
    personField:'seatNumber',
    grouping:'product+variant+modifiers+notes+appliedPrice+station+state+source',
    activeDeliveryEditor:'V93',
    deliveryAppliedPrice:true,
    zeroPrice:'allowed-by-existing-sales-contract',
    negativePrice:false
  }));
}

main();
