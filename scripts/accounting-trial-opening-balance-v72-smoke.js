const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mergeTrialAccounts } = require('../src/modules/accounting/accounting-reporting.service');

function account(id, codigo, naturaleza = 'DEBITO') {
  return { id, codigo, nombre: `Cuenta ${codigo}`, naturaleza };
}

const opening = [
  { cuenta: account('a', '110505', 'DEBITO'), debito: 100, credito: 0, saldo: 100 },
  { cuenta: account('b', '220505', 'CREDITO'), debito: 0, credito: 200, saldo: 200 },
  { cuenta: account('c', '130505', 'DEBITO'), debito: 75, credito: 0, saldo: 75 }
];

const period = [
  { cuenta: account('a', '110505', 'DEBITO'), debito: 50, credito: 20, saldo: 30 },
  { cuenta: account('b', '220505', 'CREDITO'), debito: 30, credito: 80, saldo: 50 },
  { cuenta: account('d', '413505', 'CREDITO'), debito: 0, credito: 90, saldo: 90 }
];

const merged = mergeTrialAccounts(period, opening);
assert.equal(merged.length, 4, 'debe conservar cuentas con saldo previo aunque no tengan movimiento actual');
assert.deepEqual(merged.map((x) => x.cuenta.codigo), ['110505', '130505', '220505', '413505']);

const a = merged.find((x) => x.cuenta.id === 'a');
assert.equal(Number(a.saldoAnterior), 100);
assert.equal(Number(a.debito), 50);
assert.equal(Number(a.credito), 20);
assert.equal(Number(a.saldo), 30, 'saldo mantiene el movimiento del periodo por compatibilidad');
assert.equal(Number(a.saldoFinal), 130);

const b = merged.find((x) => x.cuenta.id === 'b');
assert.equal(Number(b.saldoAnterior), 200);
assert.equal(Number(b.saldoFinal), 250);

const c = merged.find((x) => x.cuenta.id === 'c');
assert.equal(Number(c.debito), 0);
assert.equal(Number(c.credito), 0);
assert.equal(Number(c.saldoFinal), 75);

const d = merged.find((x) => x.cuenta.id === 'd');
assert.equal(Number(d.saldoAnterior), 0);
assert.equal(Number(d.saldoFinal), 90);

const reportingSource = fs.readFileSync(path.join(__dirname, '../src/modules/accounting/accounting-reporting.service.js'), 'utf8');
assert.match(reportingSource, /saldoAnteriorCorte/);
assert.match(reportingSource, /start\.getTime\(\) - 1/);
assert.match(reportingSource, /saldoFinal/);

const guardSource = fs.readFileSync(path.join(__dirname, '../src/web/accounting-runtime-guard.js'), 'utf8');
assert.match(guardSource, /VANTIX_ACCOUNTING_TRIAL_OPENING_V72/);
assert.match(guardSource, /Saldo anterior/);
assert.match(guardSource, /Saldo final/);
assert.match(guardSource, /item\.saldoAnterior/);
assert.match(guardSource, /item\.saldoFinal/);

console.log('ACCOUNTING TRIAL OPENING BALANCE V72 SMOKE OK');
