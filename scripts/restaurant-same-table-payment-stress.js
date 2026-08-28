'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const { money } = require('../src/utils/decimal');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const visitPayments = require('../src/modules/restaurant/restaurant-visit-payments.service');
const treasury = require('../src/modules/treasury/treasury.service');

const CASES = Math.max(1, Math.min(Number(process.env.SAME_TABLE_STRESS_CASES) || 24, 100));
const GUESTS = 4;
const TABLE_CONCURRENCY = Math.max(1, Math.min(Number(process.env.SAME_TABLE_STRESS_CONCURRENCY) || 12, 25));
const REPORT_DIR = process.env.STRESS_REPORT_DIR || path.join(process.cwd(), 'stress-results');
const REPORT_FILE = path.join(REPORT_DIR, 'restaurant-same-table-payment-report.json');
const RUN_ID = `SAMEPAY-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  configuration: { tables: CASES, simultaneousPartsPerTable: GUESTS, tableConcurrency: TABLE_CONCURRENCY },
  errors: [],
  invariants: [],
  totals: {},
  verdict: 'RUNNING'
};

function guard() {
  if (process.env.STRESS_CONFIRM_ISOLATED_DB !== 'YES') throw new Error('STRESS_CONFIRM_ISOLATED_DB=YES requerido');
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') throw new Error('No se permite NODE_ENV=production');
}

async function pool(items, concurrency, worker) {
  let next = 0;
  async function runner() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { await worker(items[index], index); }
      catch (error) {
        items[index].failed = true;
        report.errors.push({ table: items[index]?.table?.code || index + 1, code: error?.code || error?.name || 'ERROR', message: error?.message || String(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => runner()));
}

function invariant(name, ok, actual, expected) {
  report.invariants.push({ name, ok: Boolean(ok), actual, expected });
}

function sum(values) {
  return values.reduce((acc, value) => money(acc.plus(value || 0)), money(0));
}

async function setupTable(demo, waiter, admin, zone, menu, index) {
  const code = `${RUN_ID.slice(-12)}-${String(index + 1).padStart(3, '0')}`.slice(0, 30);
  const table = await prisma.restaurantTable.create({
    data: {
      tenantId: demo.tenantId, zoneId: zone.id, code, name: `Pago simultáneo ${index + 1}`,
      seats: GUESTS, assignedWaiterId: waiter.id, posX: 20 + index * 10, posY: 20, state: 'LIBRE'
    }
  });
  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, { guestCount: GUESTS, billingMode: 'INDIVIDUAL' });
  for (let seat = 1; seat <= GUESTS; seat += 1) {
    await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[seat - 1].id, 1, seat);
  }
  const order = await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id);
  const commands = await prisma.restaurantCommand.findMany({ where: { tenantId: demo.tenantId, orderId: order.id } });
  for (const state of ['EN_PREPARACION', 'LISTA', 'ENTREGADA']) {
    for (const command of commands) await restaurant.updateCommandState(demo.tenantId, admin, command.id, state);
  }
  await identity.prepareAccount(demo.tenantId, waiter, table.id);
  await identity.sendAccountToCash(demo.tenantId, waiter, table.id);
  const plan = await visitPayments.preparePaymentPlan(demo.tenantId, admin, table.id, { mode: 'BY_SEAT', tipAmount: 0 });
  if (plan.parts.length !== GUESTS) throw new Error(`Plan inesperado: ${plan.parts.length} partes`);
  return { table, opened, order, plan, failed: false };
}

async function main() {
  guard();
  const demo = await ensureRestaurantDemoTenant();
  const [waiter, admin, menu] = await Promise.all([
    prisma.user.findUnique({ where: { id: demo.users.MESERO } }),
    prisma.user.findUnique({ where: { id: demo.users.ADMIN } }),
    prisma.restaurantMenuItem.findMany({ where: { tenantId: demo.tenantId, active: true }, orderBy: { sortOrder: 'asc' }, take: GUESTS })
  ]);
  if (!waiter || !admin || menu.length < GUESTS) throw new Error('Demo Restaurante insuficiente para same-table stress');

  const zone = await prisma.restaurantZone.create({ data: { tenantId: demo.tenantId, name: `SamePay ${RUN_ID}`, sortOrder: 9000 } });
  const cash = await prisma.cajaBanco.create({ data: { tenantId: demo.tenantId, tipo: 'CAJA', nombre: `Caja ${RUN_ID}`, saldoActual: 0 } });
  const bank = await prisma.cajaBanco.create({ data: { tenantId: demo.tenantId, tipo: 'BANCO', nombre: `Banco ${RUN_ID}`, saldoActual: 0 } });
  await treasury.openCashSession(demo.tenantId, admin.id, cash.id, { saldoInicial: 0 });

  const placeholders = Array.from({ length: CASES }, (_, index) => ({ index, failed: false }));
  const contexts = new Array(CASES);
  await pool(placeholders, TABLE_CONCURRENCY, async ({ index }) => { contexts[index] = await setupTable(demo, waiter, admin, zone, menu, index); });
  if (report.errors.length) throw new Error(`Falló preparación de ${report.errors.length} mesa(s)`);

  const methods = [
    { metodoPago: 'EFECTIVO', cajaBancoId: cash.id },
    { metodoPago: 'TRANSFERENCIA', cajaBancoId: bank.id },
    { metodoPago: 'TARJETA', cajaBancoId: bank.id },
    { metodoPago: 'EFECTIVO', cajaBancoId: cash.id }
  ];

  // Cada worker procesa UNA mesa, pero dispara sus cuatro partes con Promise.all.
  // Esto fuerza concurrencia real sobre la misma venta/cartera/sesión.
  await pool(contexts, TABLE_CONCURRENCY, async (context) => {
    const results = await Promise.allSettled(context.plan.parts.map((part, partIndex) => {
      const method = methods[partIndex];
      return visitPayments.registerPartPayment(demo.tenantId, admin, context.table.id, {
        partKey: part.key,
        metodoPago: method.metodoPago,
        cajaBancoId: method.cajaBancoId,
        referencia: `${RUN_ID} ${context.table.code} P${partIndex + 1}`
      });
    }));
    const rejected = results.filter((row) => row.status === 'rejected');
    if (rejected.length) {
      throw new Error(rejected.map((row) => `${row.reason?.code || row.reason?.name}: ${row.reason?.message}`).join(' | '));
    }
  });

  const saleIds = contexts.map((x) => x.opened.sale.id);
  const sessionIds = contexts.map((x) => x.opened.session.id);
  const tableIds = contexts.map((x) => x.table.id);
  const [sales, receivables, payments, sessionPayments, tables, sessions, accounts] = await Promise.all([
    prisma.comprobanteComercial.findMany({ where: { tenantId: demo.tenantId, id: { in: saleIds } } }),
    prisma.cartera.findMany({ where: { tenantId: demo.tenantId, comprobanteId: { in: saleIds } } }),
    prisma.pago.findMany({ where: { tenantId: demo.tenantId, documentoId: { in: saleIds } } }),
    prisma.restaurantSessionPayment.findMany({ where: { tenantId: demo.tenantId, sessionId: { in: sessionIds } } }),
    prisma.restaurantTable.findMany({ where: { id: { in: tableIds } } }),
    prisma.restaurantTableSession.findMany({ where: { id: { in: sessionIds } } }),
    prisma.cajaBanco.findMany({ where: { id: { in: [cash.id, bank.id] } } })
  ]);

  const expectedPayments = CASES * GUESTS;
  invariant('Sin errores al pagar cuatro partes simultáneas de una misma mesa', report.errors.length === 0, report.errors.length, 0);
  invariant('Todas las partes generan pago', payments.length === expectedPayments, payments.length, expectedPayments);
  invariant('Todas las partes quedan ligadas a RestaurantSessionPayment', sessionPayments.length === expectedPayments, sessionPayments.length, expectedPayments);
  invariant('Todas las ventas quedan PAGADO_TOTAL y saldo cero', sales.length === CASES && sales.every((x) => x.estado === 'PAGADO_TOTAL' && money(x.saldo).eq(0)), sales.filter((x) => x.estado !== 'PAGADO_TOTAL' || !money(x.saldo).eq(0)).length, 0);
  invariant('Todas las carteras quedan PAGADA y saldo cero', receivables.length === CASES && receivables.every((x) => x.estado === 'PAGADA' && money(x.saldo).eq(0)), receivables.filter((x) => x.estado !== 'PAGADA' || !money(x.saldo).eq(0)).length, 0);
  invariant('Todas las mesas quedan LIBRE', tables.length === CASES && tables.every((x) => x.state === 'LIBRE'), tables.filter((x) => x.state !== 'LIBRE').length, 0);
  invariant('Todas las sesiones quedan CERRADA', sessions.length === CASES && sessions.every((x) => x.state === 'CERRADA'), sessions.filter((x) => x.state !== 'CERRADA').length, 0);

  const salesTotal = sum(sales.map((x) => x.total));
  const paymentTotal = sum(payments.map((x) => x.monto));
  invariant('Total vendido = total pagado con partes simultáneas', salesTotal.eq(paymentTotal), paymentTotal.toString(), salesTotal.toString());

  const cashExpected = sum(payments.filter((x) => x.cajaBancoId === cash.id).map((x) => x.monto));
  const bankExpected = sum(payments.filter((x) => x.cajaBancoId === bank.id).map((x) => x.monto));
  const cashRow = accounts.find((x) => x.id === cash.id);
  const bankRow = accounts.find((x) => x.id === bank.id);
  invariant('Caja exacta bajo pagos same-table simultáneos', money(cashRow?.saldoActual || 0).eq(cashExpected), String(cashRow?.saldoActual || 0), cashExpected.toString());
  invariant('Banco exacto bajo pagos same-table simultáneos', money(bankRow?.saldoActual || 0).eq(bankExpected), String(bankRow?.saldoActual || 0), bankExpected.toString());

  report.totals = {
    sales: salesTotal.toString(), payments: paymentTotal.toString(),
    cashExpected: cashExpected.toString(), cashActual: String(cashRow?.saldoActual || 0),
    bankExpected: bankExpected.toString(), bankActual: String(bankRow?.saldoActual || 0)
  };
  report.verdict = report.errors.length === 0 && report.invariants.every((x) => x.ok) ? 'PASS' : 'FAIL';
}

async function finish(error) {
  if (error) report.errors.push({ table: 'FATAL', code: error?.code || error?.name || 'ERROR', message: error?.message || String(error) });
  report.finishedAt = new Date().toISOString();
  if (error) report.verdict = 'FAIL';
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`RESTAURANT_SAME_TABLE_PAYMENT_STRESS=${report.verdict}`);
  console.log(`RESTAURANT_SAME_TABLE_PAYMENT_REPORT=${REPORT_FILE}`);
  console.log(JSON.stringify(report, null, 2));
}

main().then(() => finish()).catch((error) => finish(error).then(() => { process.exitCode = 1; })).finally(() => prisma.$disconnect());
