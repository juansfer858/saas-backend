const assert = require('node:assert/strict');
const { reportRows, toExcelHtml, toSimplePdf } = require('../src/modules/accounting/accounting-export.service');

function account(codigo, nombre) { return { codigo, nombre }; }

function assertSpec(spec, label) {
  assert.ok(Array.isArray(spec.headers) && spec.headers.length >= 3, `${label}: headers`);
  assert.equal(spec.columns.length, spec.headers.length, `${label}: columns/headers`);
  assert.equal(spec.rowStyles.length, spec.rows.length, `${label}: rowStyles/rows`);
  for (const row of spec.rows) assert.equal(row.length, spec.headers.length, `${label}: row shape`);
  assert.ok(spec.columns.every((c) => Number(c.width) > 0), `${label}: widths`);
  const totalWidth = spec.columns.reduce((a, c) => a + Number(c.width), 0);
  assert.ok(Math.abs(totalWidth - 1) < 0.001, `${label}: total width must equal 1`);
}

const diario = reportRows('diario', {
  items: [{ fecha: '2026-08-25', numeroComprobante: 'RC-001', concepto: 'Venta mostrador', origen: 'VENTAS', estado: 'CONTABILIZADO', totalDebito: 125000, totalCredito: 125000 }]
});
assertSpec(diario, 'diario');
assert.deepEqual(diario.headers, ['Fecha', 'Comprobante', 'Concepto', 'Origen', 'Estado', 'Débito', 'Crédito']);
assert.equal(diario.rowStyles.at(-1), 'grand-total');

const mayor = reportRows('mayor', {
  cuenta: account('110505', 'Caja general'),
  saldoInicial: 50000,
  saldoFinal: 175000,
  movimientos: [{ fecha: '2026-08-25', numeroComprobante: 'RC-001', concepto: 'Venta', tercero: { nombre: 'Cliente General' }, debito: 125000, credito: 0, saldo: 175000 }]
});
assertSpec(mayor, 'mayor');
assert.ok(mayor.headers.includes('Tercero'));

const trial = reportRows('balance-prueba', {
  cuentas: [{ cuenta: account('110505', 'Caja general'), debito: 125000, credito: 0, saldo: 125000 }],
  totalDebito: 125000,
  totalCredito: 125000,
  diferencia: 0
});
assertSpec(trial, 'balance-prueba');
assert.equal(trial.rowStyles.at(-1), 'grand-total');

const pnl = reportRows('estado-resultados', {
  cuentas: {
    INGRESO_OPERACIONAL: [{ cuenta: account('4135', 'Ingresos restaurante'), valor: 500000 }],
    COSTO_VENTAS: [{ cuenta: account('6135', 'Costo de ventas'), valor: 180000 }],
    GASTO_ADMINISTRACION: [],
    GASTO_VENTAS: [],
    INGRESO_NO_OPERACIONAL: [],
    GASTO_NO_OPERACIONAL: []
  },
  ingresosOperacionales: 500000,
  costoVentas: 180000,
  utilidadBruta: 320000,
  gastosAdministracion: 0,
  gastosVentas: 0,
  utilidadOperacional: 320000,
  ingresosNoOperacionales: 0,
  gastosNoOperacionales: 0,
  utilidadAntesImpuestos: 320000,
  impuestoEstimado: true,
  impuestoRenta: 112000,
  utilidadNeta: 208000
});
assertSpec(pnl, 'estado-resultados');
assert.deepEqual(pnl.headers, ['Sección', 'Código', 'Cuenta / Concepto', 'Valor']);
assert.ok(!pnl.headers.some((h) => h.includes('Código/Sección')));
assert.ok(pnl.rowStyles.includes('section'));
assert.ok(pnl.rowStyles.includes('subtotal'));
assert.ok(pnl.rowStyles.includes('grand-total'));

const balance = reportRows('balance-general', {
  grupos: {
    ACTIVO_CORRIENTE: [{ cuenta: account('110505', 'Caja general'), saldo: 500000 }],
    ACTIVO_NO_CORRIENTE: [],
    PASIVO_CORRIENTE: [{ cuenta: account('2205', 'Proveedores'), saldo: 100000 }],
    PASIVO_NO_CORRIENTE: [],
    PATRIMONIO: [{ cuenta: account('3115', 'Aportes sociales'), saldo: 400000 }]
  },
  utilidadEjercicioNoCerrada: 0,
  impuestoEstimadoNoContabilizado: 0,
  totalActivo: 500000,
  totalPasivo: 100000,
  patrimonio: 400000,
  totalPasivoPatrimonio: 500000,
  diferencia: 0
});
assertSpec(balance, 'balance-general');
assert.deepEqual(balance.headers, ['Sección', 'Código', 'Cuenta / Concepto', 'Saldo']);

for (const spec of [diario, mayor, trial, pnl, balance]) {
  const xls = toExcelHtml(spec).toString('utf8');
  assert.match(xls, /<colgroup>/);
  assert.match(xls, /table-layout:fixed/);
  assert.match(xls, /tr\.section td/);
  assert.match(xls, /tr\.grand-total td/);

  const pdf = toSimplePdf(spec);
  const raw = pdf.toString('binary');
  assert.ok(raw.startsWith('%PDF-1.4'));
  assert.match(raw, /\/MediaBox \[0 0 842 595\]/);
  assert.match(raw, / re S/);
  assert.ok(!raw.includes(' | '), `${spec.title}: PDF must not flatten columns with pipe separators`);
  for (const header of spec.headers) assert.ok(raw.includes(header), `${spec.title}: missing PDF header ${header}`);
}

console.log('ACCOUNTING REPORT COLUMN TEMPLATES SMOKE OK');
