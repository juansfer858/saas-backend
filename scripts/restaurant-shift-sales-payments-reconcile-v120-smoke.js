'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reconcile = require('../src/modules/restaurant/restaurant-shift-sales-payments-reconcile-v120.service');

function directMovement(amount, type = 'BANCO') {
  return { id:'m1', comprobanteId:'sale', cajaBancoId:'bank', monto:String(amount), cajaBanco:{ tipo:type } };
}
function payment(id, amount, receiptId, paymentMethod = 'TRANSFERENCIA') {
  return {
    id,
    documentoId:'sale',
    comprobanteTesoreriaId:receiptId,
    cajaBancoId:'bank',
    metodoPago:paymentMethod,
    monto:String(amount),
    cajaBanco:{ tipo:paymentMethod === 'EFECTIVO' ? 'CAJA' : 'BANCO' },
    comprobanteTesoreria:{ id:receiptId, estado:'EMITIDO', total:String(amount), cajaBancoId:'bank' }
  };
}
function receiptMovement(receiptId, amount) {
  return { id:`tm-${receiptId}`, comprobanteId:receiptId, cajaBancoId:'bank', monto:String(amount), cajaBanco:{ tipo:'BANCO' } };
}

const directTransfer = reconcile.reconcileSaleSettlement({
  channel:'MESAS',
  reference:'Mesa 1',
  sale:{ id:'sale', numero:'POS-1', formaPago:'BANCO', cajaBancoId:'bank', total:'25000', saldo:'0' },
  session:{ paymentMethodKind:'TRANSFERENCIA', paymentAccountId:'bank', splitMode:null },
  directMovements:[directMovement(25000)],
  payments:[], receivables:[], receiptMovements:[], sessionPayments:[]
});
assert.equal(directTransfer.balanced,true);
assert.equal(Number(directTransfer.saleTotal),25000);
assert.equal(Number(directTransfer.paidTotal),25000);
assert.equal(Number(directTransfer.difference),0);

const mismatch12500 = reconcile.reconcileSaleSettlement({
  channel:'MESAS',
  reference:'Mesa 7',
  sale:{ id:'sale', numero:'POS-2', formaPago:'BANCO', cajaBancoId:'bank', total:'25000', saldo:'0' },
  session:{ paymentMethodKind:'TRANSFERENCIA', paymentAccountId:'bank', splitMode:null },
  directMovements:[directMovement(37500)],
  payments:[], receivables:[], receiptMovements:[], sessionPayments:[]
});
assert.equal(mismatch12500.balanced,false);
assert.equal(Number(mismatch12500.difference),12500);
assert.ok(mismatch12500.issues.some((row) => row.code === 'SALE_FINANCIAL_COVERAGE_MISMATCH'));

const openCredit = reconcile.reconcileSaleSettlement({
  channel:'MESAS',
  reference:'Mesa crédito',
  sale:{ id:'sale', numero:'POS-3', formaPago:'CREDITO', cajaBancoId:null, total:'30000', saldo:'30000' },
  session:{ paymentMethodKind:'CREDITO', paymentAccountId:null, splitMode:null },
  directMovements:[], payments:[],
  receivables:[{ id:'cx1', comprobanteId:'sale', valorOriginal:'30000', saldo:'30000', estado:'PENDIENTE' }],
  receiptMovements:[], sessionPayments:[]
});
assert.equal(openCredit.balanced,true);
assert.equal(Number(openCredit.paidTotal),0);
assert.equal(Number(openCredit.receivableBalance),30000);
assert.equal(Number(openCredit.financialCoverage),30000);

const p1 = payment('p1',15000,'r1');
const p2 = payment('p2',15000,'r2');
const split = reconcile.reconcileSaleSettlement({
  channel:'MESAS',
  reference:'Mesa dividida',
  sale:{ id:'sale', numero:'POS-4', formaPago:'CREDITO', cajaBancoId:null, total:'30000', saldo:'0' },
  session:{ paymentMethodKind:null, paymentAccountId:null, splitMode:'EQUAL' },
  directMovements:[], payments:[p1,p2],
  receivables:[{ id:'cx2', comprobanteId:'sale', valorOriginal:'30000', saldo:'0', estado:'PAGADA' }],
  receiptMovements:[receiptMovement('r1',15000),receiptMovement('r2',15000)],
  sessionPayments:[
    { id:'sp1', partKey:'P1', treasuryPaymentId:'p1', metodoPago:'TRANSFERENCIA', cajaBancoId:'bank', saleAmount:'15000' },
    { id:'sp2', partKey:'P2', treasuryPaymentId:'p2', metodoPago:'TRANSFERENCIA', cajaBancoId:'bank', saleAmount:'15000' }
  ]
});
assert.equal(split.balanced,true);
assert.equal(Number(split.paidTotal),30000);
assert.equal(Number(split.receivableBalance),0);

const brokenReceipt = reconcile.reconcileSaleSettlement({
  channel:'MESAS',
  reference:'Mesa dividida',
  sale:{ id:'sale', numero:'POS-5', formaPago:'CREDITO', cajaBancoId:null, total:'30000', saldo:'0' },
  session:{ splitMode:'EQUAL' },
  directMovements:[], payments:[p1,p2],
  receivables:[{ id:'cx3', comprobanteId:'sale', valorOriginal:'30000', saldo:'0', estado:'PAGADA' }],
  receiptMovements:[receiptMovement('r1',27500),receiptMovement('r2',15000)],
  sessionPayments:[
    { id:'sp1', partKey:'P1', treasuryPaymentId:'p1', metodoPago:'TRANSFERENCIA', cajaBancoId:'bank', saleAmount:'15000' },
    { id:'sp2', partKey:'P2', treasuryPaymentId:'p2', metodoPago:'TRANSFERENCIA', cajaBancoId:'bank', saleAmount:'15000' }
  ]
});
assert.equal(brokenReceipt.balanced,false);
assert.ok(brokenReceipt.issues.some((row) => row.code === 'PAYMENT_TREASURY_AMOUNT_MISMATCH'));

const deliveryPayment = payment('pd',30000,'rd');
const delivery = reconcile.reconcileSaleSettlement({
  channel:'DOMICILIO',
  reference:'D-001',
  sale:{ id:'sale', numero:'POS-6', formaPago:'CREDITO', cajaBancoId:null, total:'30000', saldo:'0' },
  delivery:{ id:'delivery', treasuryPaymentId:'pd', paymentMethod:'TRANSFERENCIA', cajaBancoId:'bank', total:'30000' },
  directMovements:[], payments:[deliveryPayment],
  receivables:[{ id:'cx4', comprobanteId:'sale', valorOriginal:'30000', saldo:'0', estado:'PAGADA' }],
  receiptMovements:[receiptMovement('rd',30000)], sessionPayments:[]
});
assert.equal(delivery.balanced,true);

const closeSource = fs.readFileSync(path.join(__dirname,'..','src','modules','restaurant','restaurant-shift-close-v111.service.js'),'utf8');
assert.match(closeSource,/restaurant-shift-sales-payments-reconcile-v120\.service/);
assert.match(closeSource,/RESTAURANT_SHIFT_CLOSE_SALES_PAYMENTS_MISMATCH/);

console.log('RESTAURANT SHIFT SALES PAYMENTS RECONCILE V120 OK', JSON.stringify({
  directTransfer:true,
  mismatch12500Blocked:true,
  openCreditCoveredByReceivable:true,
  splitPayments:true,
  treasuryReceiptMismatchBlocked:true,
  deliveryPayment:true
}));
