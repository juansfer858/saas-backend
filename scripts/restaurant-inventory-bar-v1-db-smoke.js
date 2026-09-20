'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const inventory = require('../src/modules/restaurant/restaurant-inventory-bar-v1.service');
const demoBar = require('../src/modules/restaurant/restaurant-demo-bar-accounts-v1.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const { V2_OPTIONS } = require('../src/modules/restaurant/restaurant-v2-orders.routes');

async function cleanup(demo, ids) {
  const { productId, menuItemId, tableId, zoneId, sessionId, saleId } = ids;
  await prisma.restaurantInventoryPurchaseItem.deleteMany({ where:{ tenantId:demo.tenantId, productId } }).catch(()=>{});
  await prisma.restaurantInventoryPurchase.deleteMany({ where:{ tenantId:demo.tenantId, createdByUserId:demo.users.ADMIN, supplier:{ startsWith:'Smoke Inventory ' } } }).catch(()=>{});
  await prisma.restaurantInventoryMovement.deleteMany({ where:{ tenantId:demo.tenantId, productId } }).catch(()=>{});
  await prisma.restaurantInventoryStock.deleteMany({ where:{ tenantId:demo.tenantId, productId } }).catch(()=>{});
  if (sessionId) {
    const orders = await prisma.restaurantOrder.findMany({ where:{ tenantId:demo.tenantId, sessionId }, select:{ id:true } }).catch(()=>[]);
    const orderIds = orders.map((row)=>row.id);
    if (orderIds.length) {
      await prisma.restaurantCommand.deleteMany({ where:{ tenantId:demo.tenantId, orderId:{ in:orderIds } } }).catch(()=>{});
      await prisma.restaurantOrderItem.deleteMany({ where:{ tenantId:demo.tenantId, orderId:{ in:orderIds } } }).catch(()=>{});
      await prisma.restaurantOrder.deleteMany({ where:{ tenantId:demo.tenantId, id:{ in:orderIds } } }).catch(()=>{});
    }
    await prisma.restaurantTableSession.deleteMany({ where:{ tenantId:demo.tenantId, id:sessionId } }).catch(()=>{});
  }
  if (saleId) {
    await prisma.detalleComprobante.deleteMany({ where:{ tenantId:demo.tenantId, comprobanteId:saleId } }).catch(()=>{});
    await prisma.comprobanteComercial.deleteMany({ where:{ tenantId:demo.tenantId, id:saleId } }).catch(()=>{});
  }
  if (menuItemId) await prisma.restaurantMenuItem.deleteMany({ where:{ tenantId:demo.tenantId, id:menuItemId } }).catch(()=>{});
  if (productId) await prisma.producto.deleteMany({ where:{ tenantId:demo.tenantId, id:productId } }).catch(()=>{});
  if (tableId) await prisma.restaurantTable.deleteMany({ where:{ tenantId:demo.tenantId, id:tableId } }).catch(()=>{});
  if (zoneId) await prisma.restaurantZone.deleteMany({ where:{ tenantId:demo.tenantId, id:zoneId } }).catch(()=>{});
}

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const admin = await prisma.user.findUnique({ where:{ id:demo.users.ADMIN } });
  assert.ok(admin, 'demo needs ADMIN');
  const suffix = crypto.randomBytes(4).toString('hex');
  const ids = {};
  try {
    const product = await prisma.producto.create({
      data:{
        tenantId:demo.tenantId,
        sku:'INV-SMOKE-'+suffix,
        nombre:'Producto inventario '+suffix,
        unidadMedida:'UND',
        controlaInventario:true,
        stockActual:7,
        costoPromedio:4500,
        precio1:9000,
        activo:true
      }
    });
    ids.productId = product.id;
    const menuItem = await prisma.restaurantMenuItem.create({
      data:{
        tenantId:demo.tenantId,
        productId:product.id,
        category:'ENTRADAS',
        station:'COCINA',
        requiresRecipe:false,
        active:true,
        sortOrder:9999
      }
    });
    ids.menuItemId = menuItem.id;

    const zone = await prisma.restaurantZone.create({ data:{ tenantId:demo.tenantId, name:'INV '+suffix, sortOrder:9999 } });
    ids.zoneId = zone.id;
    const table = await prisma.restaurantTable.create({ data:{ tenantId:demo.tenantId, zoneId:zone.id, code:'INV-'+suffix, name:'Mesa Inv '+suffix, seats:2 } });
    ids.tableId = table.id;
    const account = await demoBar.createAccount(demo.tenantId, admin, table.id, { name:'Cuenta inventario' });
    ids.sessionId = account.account.id;
    const session = await prisma.restaurantTableSession.findUnique({ where:{ id:ids.sessionId } });
    ids.saleId = session.saleId;

    const enabled = await inventory.configureTracking(demo.tenantId, admin.id, product.id, true);
    assert.equal(enabled.enabled, true);
    const migratedProduct = await prisma.producto.findUnique({ where:{ id:product.id } });
    assert.equal(migratedProduct.controlaInventario, false, 'Super Core finished-product inventory must be disabled after local migration');

    let ws = await inventory.workspace(demo.tenantId);
    let row = ws.products.find((item)=>item.productId===product.id);
    assert.equal(row.onHand, 7, 'legacy stock must migrate as local opening balance');
    assert.equal(row.reserved, 0);
    assert.equal(row.available, 7);

    await identity.setWaiterDraftItem(demo.tenantId, admin, ids.sessionId, menuItem.id, 2, null, V2_OPTIONS);
    const sent = await identity.sendWaiterDraft(demo.tenantId, admin, ids.sessionId, V2_OPTIONS);
    assert.equal(sent.state, 'ENVIADO');

    ws = await inventory.workspace(demo.tenantId);
    row = ws.products.find((item)=>item.productId===product.id);
    assert.equal(row.onHand, 7, 'sending must reserve, not deduct');
    assert.equal(row.reserved, 2);
    assert.equal(row.available, 5);

    await prisma.$transaction(async (tx)=>{
      await inventory.consumeSaleInTx(tx, demo.tenantId, admin.id, ids.sessionId, ids.saleId);
      await tx.restaurantTableSession.update({ where:{ id:ids.sessionId }, data:{ state:'CERRADA', closedAt:new Date(), closedByUserId:admin.id } });
    });

    ws = await inventory.workspace(demo.tenantId);
    row = ws.products.find((item)=>item.productId===product.id);
    assert.equal(row.onHand, 5, 'payment consumption must deduct local stock');
    assert.equal(row.reserved, 0, 'closed session must release reservation');
    assert.equal(row.available, 5);

    const draft = await inventory.savePurchase(demo.tenantId, admin.id, {
      supplier:'Smoke Inventory '+suffix,
      reference:'FAC-'+suffix,
      purchaseDate:'2026-09-20',
      paymentTerms:'cash',
      dueDate:null,
      notes:'CI inventory purchase',
      items:[{ productId:product.id, quantity:3, unitCost:5000, taxPercent:0 }]
    });
    assert.equal(draft.purchase.status, 'draft');
    ws = await inventory.workspace(demo.tenantId);
    row = ws.products.find((item)=>item.productId===product.id);
    assert.equal(row.onHand, 5, 'draft purchase must not move stock');

    const received = await inventory.receivePurchase(demo.tenantId, admin.id, draft.purchase.id);
    assert.equal(received.purchase.status, 'received');
    ws = await inventory.workspace(demo.tenantId);
    row = ws.products.find((item)=>item.productId===product.id);
    assert.equal(row.onHand, 8, 'receiving purchase must increase stock');

    const costs = await inventory.costHistory(demo.tenantId, product.id);
    assert.equal(costs.length, 1);
    assert.equal(costs[0].unitCost, 5000);

    const history = await inventory.history(demo.tenantId, {});
    const kinds = history.rows.filter((item)=>item.productId===product.id).map((item)=>item.kind);
    assert.ok(kinds.includes('initial'));
    assert.ok(kinds.includes('reserve'));
    assert.ok(kinds.includes('sale'));
    assert.ok(kinds.includes('entry'));

    const other = await prisma.tenant.create({
      data:{ nombreEmpresa:'Other Inv '+suffix, subdomain:'other-inv-'+suffix, nicho:'RESTAURANTE', pais:'CO', moneda:'COP', activo:true }
    });
    try {
      await assert.rejects(
        ()=>inventory.workspace(other.id),
        (error)=>error.code==='RESTAURANT_INVENTORY_NOT_ENABLED',
        'inventory pilot must stay isolated'
      );
    } finally {
      await prisma.tenant.delete({ where:{ id:other.id } });
    }

    const routes = fs.readFileSync('src/modules/restaurant/restaurant-inventory-bar-v1.routes.js','utf8');
    const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-inventory-bar-v1.public.routes.js','utf8');
    const ui = fs.readFileSync('src/web/restaurant-v2-inventory-bar-v1.js','utf8');
    const html = fs.readFileSync('src/web/restaurant-v2-inventory-bar-v1.html','utf8');
    const nav = fs.readFileSync('src/web/restaurant-v2-native-control-p11.js','utf8');
    const menuEdit = fs.readFileSync('src/modules/restaurant/restaurant-menu-item-edit.service.js','utf8');
    const identitySource = fs.readFileSync('src/modules/restaurant/restaurant-identity.service.js','utf8');
    const restaurantSource = fs.readFileSync('src/modules/restaurant/restaurant.service.js','utf8');

    assert.match(routes, /\/inventario-v1/);
    assert.match(publicRoutes, /\/app\/restaurante-v2\/inventario/);
    assert.match(html, /Disponible = saldo − reservado/);
    assert.match(ui, /Afecta inventario/);
    assert.match(html, /\+ Agregar pedido/);
    assert.match(html, /Exportar existencias/);
    assert.match(nav, /inventario:\{ label:'Inventario'/);
    assert.match(nav, /key === 'inventario' && session\.subdomain !== DEMO_RESTAURANTE/);
    assert.match(menuEdit, /restaurantInventory\.configureTrackingInTx/);
    assert.match(identitySource, /restaurantInventory\.assertItemsAvailableInTx/);
    assert.match(identitySource, /restaurantInventory\.recordReservationInTx/);
    assert.match(restaurantSource, /restaurantInventory\.consumeSaleInTx/);

    console.log('RESTAURANT_INVENTORY_BAR_V1=PASS');
    console.log('SOURCE_OF_TRUTH=RESTAURANT_OWNED');
    console.log('LEGACY_CORE_DIRECT_INVENTORY_DISABLED=PASS');
    console.log('ORDER_SEND_RESERVES=PASS');
    console.log('PAYMENT_CONSUMES=PASS');
    console.log('PURCHASE_DRAFT_NO_STOCK=PASS');
    console.log('PURCHASE_RECEIVE_INCREASES_STOCK=PASS');
    console.log('COST_HISTORY_LAST_3=PASS');
    console.log('TENANT_ISOLATION=PASS');
  } finally {
    await cleanup(demo, ids);
  }
}

main().catch((error)=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
