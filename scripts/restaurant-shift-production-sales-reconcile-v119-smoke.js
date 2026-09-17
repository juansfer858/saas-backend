'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reconcile = require('../src/modules/restaurant/restaurant-shift-production-sales-reconcile-v119.service');

function detail(id, description, quantity, total, sku = null) {
  return {
    id,
    descripcion:description,
    cantidad:String(quantity),
    precioUnitario:String(Number(total) / Number(quantity || 1)),
    totalLinea:String(total),
    producto:{ sku }
  };
}

function item(id, detailId, description, quantity, total) {
  return {
    id,
    saleDetailId:detailId,
    description,
    quantity:String(quantity),
    unitPrice:String(Number(total) / Number(quantity || 1)),
    lineTotal:String(total)
  };
}

const balanced = reconcile.reconcileSaleRecord({
  channel:'MESAS',
  reference:'Mesa 1',
  sale:{ id:'sale-1', numero:'POS-1', total:'25000', detalles:[detail('d1','Hamburguesa',1,25000)] },
  productionItems:[item('i1','d1','Hamburguesa',1,25000)]
});
assert.equal(balanced.balanced,true);
assert.equal(Number(balanced.difference),0);
assert.equal(Number(balanced.productionTotal),25000);

// Caso real que queremos impedir: Producción conserva $12.500 más que la venta.
const mismatch12500 = reconcile.reconcileSaleRecord({
  channel:'MESAS',
  reference:'Mesa 7',
  sale:{ id:'sale-2', numero:'POS-2', total:'25000', detalles:[detail('d2','Plato',1,25000)] },
  productionItems:[item('i2','d2','Plato',1,37500)]
});
assert.equal(mismatch12500.balanced,false);
assert.equal(Number(mismatch12500.difference),12500);
assert.ok(mismatch12500.issues.some((row) => row.code === 'PRODUCTION_SALE_AMOUNT_MISMATCH'));
assert.ok(mismatch12500.issues.some((row) => row.code === 'PRODUCTION_SALE_TOTAL_MISMATCH'));

// Editar precio en Caja es válido cuando la línea operativa y financiera quedan sincronizadas.
const editedPrice = reconcile.reconcileSaleRecord({
  channel:'MESAS',
  reference:'Mesa 2',
  sale:{ id:'sale-3', numero:'POS-3', total:'12500', detalles:[detail('d3','Bebida',1,12500)] },
  productionItems:[item('i3','d3','Bebida',1,12500)]
});
assert.equal(editedPrice.balanced,true);
assert.equal(Number(editedPrice.saleTotal),12500);

// El domicilio es un cargo financiero permitido: suma a la venta, no crea una comanda falsa.
const delivery = reconcile.reconcileSaleRecord({
  channel:'DOMICILIO',
  reference:'D-001',
  sale:{
    id:'sale-4',
    numero:'POS-4',
    total:'30000',
    detalles:[
      detail('d4','Pizza',1,25000),
      detail('fee','Servicio de domicilio',1,5000,'REST-DELIVERY-FEE')
    ]
  },
  productionItems:[item('i4','d4','Pizza',1,25000)]
});
assert.equal(delivery.balanced,true);
assert.equal(Number(delivery.productionTotal),25000);
assert.equal(Number(delivery.nonProductionCharges),5000);
assert.equal(Number(delivery.saleTotal),30000);

// Una línea de venta ajena a Producción debe bloquear el cierre.
const extraSaleLine = reconcile.reconcileSaleRecord({
  channel:'MESAS',
  reference:'Mesa 3',
  sale:{
    id:'sale-5',
    numero:'POS-5',
    total:'35000',
    detalles:[detail('d5','Almuerzo',1,30000),detail('ghost','Producto fantasma',1,5000)]
  },
  productionItems:[item('i5','d5','Almuerzo',1,30000)]
});
assert.equal(extraSaleLine.balanced,false);
assert.ok(extraSaleLine.issues.some((row) => row.code === 'SALE_DETAIL_WITHOUT_PRODUCTION'));
assert.equal(Number(extraSaleLine.difference),-5000);

const closePath = path.join(__dirname,'..','src','modules','restaurant','restaurant-shift-close-v111.service.js');
const closeSource = fs.readFileSync(closePath,'utf8');
assert.match(closeSource,/restaurant-shift-production-sales-reconcile-v119\.service/);
assert.match(closeSource,/reconcileShiftProductionSales\(tx,tenantId,shift\)/);
assert.match(closeSource,/RESTAURANT_SHIFT_CLOSE_PRODUCTION_SALES_MISMATCH/);
assert.match(closeSource,/productionSalesReconciliation/);
assert.match(closeSource,/productionSalesSummary/);
assert.match(closeSource,/salesPaymentsSummary/);

console.log('RESTAURANT SHIFT PRODUCTION SALES RECONCILE V119 OK', JSON.stringify({
  exactMatch:true,
  mismatch12500Blocked:true,
  cashPriceEditCompatible:true,
  deliveryFeeSeparated:true,
  orphanSaleLineBlocked:true,
  closeGateInstalled:true
}));
