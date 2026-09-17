'use strict';

const { decimal, money } = require('../../utils/decimal');
const posReceiptPrint = require('./restaurant-pos-receipt-print.service');

const MARKER = 'VANTIX_RESTAURANT_CLOSE_SALES_RECONCILE_V116';

function moneyString(value) { return money(value || 0).toString(); }
function kind(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'EFECTIVO') return 'cashSales';
  if (raw === 'TRANSFERENCIA') return 'transferSales';
  if (raw === 'TARJETA') return 'cardSales';
  if (raw === 'CREDITO') return 'creditSales';
  return 'bankOtherSales';
}

if (!posReceiptPrint.__restaurantCloseSalesReconcileV116) {
  const previous = posReceiptPrint.buildCashCloseSnapshot;
  posReceiptPrint.buildCashCloseSnapshot = async function buildCashCloseSnapshotSalesV116(...args) {
    const base = await previous(...args);
    if (!base?.tables) return base;
    const totals = {
      cashSales:decimal(0), transferSales:decimal(0), cardSales:decimal(0), bankOtherSales:decimal(0), creditSales:decimal(0)
    };
    let salesTotal = decimal(0);
    for (const row of base.tables) {
      const saleValue = decimal(row.saleTotal || 0);
      salesTotal = salesTotal.plus(saleValue);
      const key = kind(row.paymentMethodKind);
      totals[key] = totals[key].plus(saleValue);
    }
    return {
      ...base,
      restaurantClosedTablesTotal:moneyString(salesTotal),
      paymentBreakdown:{
        ...base.paymentBreakdown,
        cashSales:moneyString(totals.cashSales),
        transferSales:moneyString(totals.transferSales),
        cardSales:moneyString(totals.cardSales),
        bankOtherSales:moneyString(totals.bankOtherSales),
        electronicSales:moneyString(totals.transferSales.plus(totals.cardSales).plus(totals.bankOtherSales)),
        creditSales:moneyString(totals.creditSales),
        exactMethodBreakdown:true,
        salesExcludeTips:true
      }
    };
  };
  Object.defineProperty(posReceiptPrint,'__restaurantCloseSalesReconcileV116',{value:true,enumerable:false});
}

module.exports = { MARKER };
