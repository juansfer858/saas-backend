'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const { money, qty } = require('../src/utils/decimal');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const visitPayments = require('../src/modules/restaurant/restaurant-visit-payments.service');
const treasury = require('../src/modules/treasury/treasury.service');

const TABLES = Math.max(1, Math.min(Number(process.env.STRESS_TABLES) || 96, 500));
const ROUNDS = Math.max(1, Math.min(Number(process.env.STRESS_ROUNDS) || 3, 10));
const GUESTS = Math.max(2, Math.min(Number(process.env.STRESS_GUESTS) || 4, 10));
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.STRESS_CONCURRENCY) || 32, 100));
const REPORT_DIR = process.env.STRESS_REPORT_DIR || path.join(process.cwd(), 'stress-results');
const REPORT_JSON = path.join(REPORT_DIR, 'restaurant-massive-stress-report.json');
const REPORT_MD = path.join(REPORT_DIR, 'restaurant-massive-stress-report.md');
const STRESS_ID = `RSTRESS-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

const report = {
  stressId: STRESS_ID,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: 0,
  configuration: { tables: TABLES, rounds: ROUNDS, guestsPerTable: GUESTS, concurrency: CONCURRENCY },
  workload: {},
  timings: {},
  invariants: [],
  errors: [],
  findings: [],
  verdict: 'RUNNING'
};

function dbGuard() {
  if (process.env.STRESS_CONFIRM_ISOLATED_DB !== 'YES') {
    throw new Error('STRESS_CONFIRM_ISOLATED_DB=YES es obligatorio. Este laboratorio NO puede ejecutarse accidentalmente contra producción.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatorio');
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') throw new Error('El laboratorio se niega a ejecutar con NODE_ENV=production');
  const url = new URL(process.env.DATABASE_URL);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
  const explicitlyRemote = process.env.STRESS_ALLOW_REMOTE_ISOLATED_DB === 'YES';
  if (!localHosts.has(url.hostname) && process.env.CI !== 'true' && !explicitlyRemote) {
    throw new Error(`Base remota ${url.hostname} bloqueada. Use una DB aislada local o STRESS_ALLOW_REMOTE_ISOLATED_DB=YES bajo su responsabilidad.`);
  }
  return { host: url.hostname, database: url.pathname.replace(/^\//, '') };
}

function recordTiming(name, elapsedMs) {
  if (!report.timings[name]) report.timings[name] = [];
  report.timings[name].push(elapsedMs);
}

async function timed(name, fn) {
  const start = performance.now();
  try { return await fn(); }
  finally { recordTiming(name, Math.round((performance.now() - start) * 100) / 100); }
}

function pctl(values, percentile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))];
}

function timingSummary() {
  const out = {};
  for (const [name, values] of Object.entries(report.timings)) {
    const sum = values.reduce((a, b) => a + b, 0);
    out[name] = {
      count: values.length,
      avgMs: Math.round((sum / Math.max(values.length, 1)) * 100) / 100,
      p50Ms: pctl(values, 0.50),
      p95Ms: pctl(values, 0.95),
      maxMs: values.length ? Math.max(...values) : 0
    };
  }
  return out;
}

function taskId(item) {
  return item?.table?.code || item?.code || item?.id || String(item);
}

function errorData(phase, item, error) {
  return {
    phase,
    target: taskId(item),
    code: error?.code || error?.name || 'ERROR',
    message: error?.message || String(error),
    details: error?.details || null
  };
}

async function runPool(phase, items, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      try {
        results[index] = await worker(item, index);
      } catch (error) {
        report.errors.push(errorData(phase, item, error));
        if (item && typeof item === 'object') item.failed = true;
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(items.length, 1)) }, () => runner()));
  return results;
}

function addInvariant(name, ok, actual, expected, severity = 'CRITICAL') {
  const row = { name, ok: Boolean(ok), actual, expected, severity };
  report.invariants.push(row);
  if (!row.ok) report.findings.push({ severity, name, actual, expected });
  return row.ok;
}

function decimalSum(values) {
  return values.reduce((acc, value) => money(acc.plus(value || 0)), money(0));
}

async function prepareInventory(tenantId) {
  const ingredients = await prisma.producto.findMany({
    where: { tenantId, sku: { startsWith: 'ING-' }, activo: true, controlaInventario: true },
    orderBy: { sku: 'asc' }
  });
  if (!ingredients.length) throw new Error('No hay insumos de receta para el laboratorio');
  const baseline = new Map();
  for (const item of ingredients) {
    const stock = qty(1_000_000);
    await prisma.producto.update({ where: { id: item.id }, data: { stockActual: stock } });
    baseline.set(item.id, { id: item.id, sku: item.sku, nombre: item.nombre, stock });
  }
  return baseline;
}

async function createStressTables(tenantId, waiter, zoneId) {
  const rows = Array.from({ length: TABLES }, (_, index) => ({ index: index + 1 }));
  const contexts = [];
  await runPool('setup_tables', rows, async ({ index }) => {
    const code = `${STRESS_ID.slice(-11)}-${String(index).padStart(3, '0')}`.slice(0, 30);
    const table = await timed('create_table', () => prisma.restaurantTable.create({
      data: {
        tenantId,
        zoneId,
        code,
        name: `Stress Mesa ${index}`,
        seats: GUESTS,
        assignedWaiterId: waiter.id,
        posX: 20 + ((index - 1) % 12) * 130,
        posY: 20 + Math.floor((index - 1) / 12) * 105,
        state: 'LIBRE'
      }
    }));
    contexts.push({ index, table, failed: false, orders: [], plan: null, opened: null });
    return table;
  });
  contexts.sort((a, b) => a.index - b.index);
  return contexts;
}

async function addRound(tenantId, waiter, menu, context, round) {
  if (context.failed || !context.opened) return null;
  for (let seat = 1; seat <= GUESTS; seat += 1) {
    const menuItem = menu[(seat - 1 + round - 1) % menu.length];
    const quantity = 1 + ((context.index + seat + round) % 2);
    await timed('draft_item', () => identity.setWaiterDraftItem(
      tenantId,
      waiter,
      context.opened.session.id,
      menuItem.id,
      quantity,
      seat
    ));
  }
  const sent = await timed('send_order', () => identity.sendWaiterDraft(tenantId, waiter, context.opened.session.id));
  context.orders.push(sent);
  return sent;
}

async function main() {
  const overallStart = Date.now();
  const db = dbGuard();
  report.database = { host: db.host, database: db.database, isolatedGuard: true };

  const demo = await timed('bootstrap_demo', () => ensureRestaurantDemoTenant());
  const [waiter, admin] = await Promise.all([
    prisma.user.findUnique({ where: { id: demo.users.MESERO } }),
    prisma.user.findUnique({ where: { id: demo.users.ADMIN } })
  ]);
  if (!waiter || !admin) throw new Error('Usuarios demo Restaurante incompletos');

  const menu = await prisma.restaurantMenuItem.findMany({
    where: { tenantId: demo.tenantId, active: true },
    orderBy: { sortOrder: 'asc' }
  });
  if (menu.length < GUESTS) throw new Error(`El laboratorio requiere al menos ${GUESTS} ítems de menú activos`);

  const ingredientBaseline = await timed('prepare_inventory', () => prepareInventory(demo.tenantId));
  const zone = await prisma.restaurantZone.create({ data: { tenantId: demo.tenantId, name: `Stress ${STRESS_ID}`, sortOrder: 5000 } });
  const cash = await prisma.cajaBanco.create({ data: { tenantId: demo.tenantId, tipo: 'CAJA', nombre: `Caja ${STRESS_ID}`, saldoActual: 0 } });
  const bank = await prisma.cajaBanco.create({ data: { tenantId: demo.tenantId, tipo: 'BANCO', nombre: `Banco ${STRESS_ID}`, saldoActual: 0 } });
  const cashShift = await treasury.openCashSession(demo.tenantId, admin.id, cash.id, { saldoInicial: 0 });

  const contexts = await createStressTables(demo.tenantId, waiter, zone.id);
  report.workload.tablesCreated = contexts.length;

  await runPool('open_tables', contexts, async (context) => {
    context.opened = await timed('open_table', () => restaurant.openTable(demo.tenantId, waiter, context.table.id, {
      guestCount: GUESTS,
      billingMode: 'INDIVIDUAL'
    }));
    return context.opened;
  });

  for (let round = 1; round <= ROUNDS; round += 1) {
    await runPool(`orders_round_${round}`, contexts.filter((x) => !x.failed), (context) => addRound(demo.tenantId, waiter, menu, context, round));
  }

  const successfulOrders = contexts.flatMap((x) => x.orders || []);
  const orderIds = successfulOrders.map((x) => x.id);
  const commands = orderIds.length ? await prisma.restaurantCommand.findMany({
    where: { tenantId: demo.tenantId, orderId: { in: orderIds } },
    orderBy: { creadoEn: 'asc' }
  }) : [];

  for (const state of ['EN_PREPARACION', 'LISTA', 'ENTREGADA']) {
    await runPool(`kds_${state.toLowerCase()}`, commands, (command) => timed(`command_${state.toLowerCase()}`, () => restaurant.updateCommandState(demo.tenantId, admin, command.id, state)));
  }

  await runPool('prepare_accounts', contexts.filter((x) => !x.failed), async (context) => {
    await timed('prepare_account', () => identity.prepareAccount(demo.tenantId, waiter, context.table.id));
    await timed('send_to_cash', () => identity.sendAccountToCash(demo.tenantId, waiter, context.table.id));
    return true;
  });

  await runPool('payment_plans', contexts.filter((x) => !x.failed), async (context) => {
    context.plan = await timed('prepare_payment_plan', () => visitPayments.preparePaymentPlan(demo.tenantId, admin, context.table.id, {
      mode: 'BY_SEAT',
      tipAmount: 0
    }));
    return context.plan;
  });

  const paymentMethods = [
    { metodoPago: 'EFECTIVO', cajaBancoId: cash.id },
    { metodoPago: 'TRANSFERENCIA', cajaBancoId: bank.id },
    { metodoPago: 'TARJETA', cajaBancoId: bank.id },
    { metodoPago: 'EFECTIVO', cajaBancoId: cash.id },
    { metodoPago: 'TRANSFERENCIA', cajaBancoId: bank.id },
    { metodoPago: 'TARJETA', cajaBancoId: bank.id }
  ];

  for (let partIndex = 0; partIndex < GUESTS; partIndex += 1) {
    const payable = contexts.filter((x) => !x.failed && x.plan?.parts?.[partIndex]);
    await runPool(`payments_part_${partIndex + 1}`, payable, async (context) => {
      const method = paymentMethods[partIndex % paymentMethods.length];
      context.settlement = await timed('register_payment', () => visitPayments.registerPartPayment(demo.tenantId, admin, context.table.id, {
        partKey: context.plan.parts[partIndex].key,
        metodoPago: method.metodoPago,
        cajaBancoId: method.cajaBancoId,
        referencia: `${STRESS_ID} mesa ${context.index} persona ${partIndex + 1}`
      }));
      return context.settlement;
    });
  }

  const sessionIds = contexts.map((x) => x.opened?.session?.id).filter(Boolean);
  const saleIds = contexts.map((x) => x.opened?.sale?.id).filter(Boolean);
  const tableIds = contexts.map((x) => x.table.id);

  const [finalTables, finalSessions, sales, sessionPayments, payments, receivables, consumptionRuns] = await Promise.all([
    prisma.restaurantTable.findMany({ where: { tenantId: demo.tenantId, id: { in: tableIds } } }),
    prisma.restaurantTableSession.findMany({ where: { tenantId: demo.tenantId, id: { in: sessionIds } } }),
    prisma.comprobanteComercial.findMany({ where: { tenantId: demo.tenantId, id: { in: saleIds } } }),
    prisma.restaurantSessionPayment.findMany({ where: { tenantId: demo.tenantId, sessionId: { in: sessionIds } } }),
    prisma.pago.findMany({ where: { tenantId: demo.tenantId, documentoId: { in: saleIds } } }),
    prisma.cartera.findMany({ where: { tenantId: demo.tenantId, comprobanteId: { in: saleIds } } }),
    prisma.consumptionRun.findMany({ where: { tenantId: demo.tenantId, sourceType: 'SALE', sourceId: { in: saleIds } }, include: { items: true } })
  ]);

  const receiptIds = payments.map((x) => x.comprobanteTesoreriaId).filter(Boolean);
  const journalDocumentIds = [...saleIds, ...receiptIds];
  const [journals, treasuryMovements, inventoryMovements, finalAccounts, finalIngredients, shiftRow, dianDocs, stressItems, stressOrders] = await Promise.all([
    prisma.asientoContable.findMany({ where: { tenantId: demo.tenantId, comprobanteId: { in: journalDocumentIds } }, include: { detalles: true } }),
    prisma.movimientoTesoreria.findMany({ where: { tenantId: demo.tenantId, comprobanteId: { in: receiptIds } } }),
    prisma.movimientoInventario.findMany({ where: { tenantId: demo.tenantId, comprobanteId: { in: saleIds }, tipo: 'VENTA' } }),
    prisma.cajaBanco.findMany({ where: { id: { in: [cash.id, bank.id] } } }),
    prisma.producto.findMany({ where: { id: { in: [...ingredientBaseline.keys()] } }, orderBy: { sku: 'asc' } }),
    prisma.aperturaCierreCaja.findUnique({ where: { id: cashShift.id } }),
    prisma.dianDocument.findMany({ where: { tenantId: demo.tenantId, originType: 'COMPROBANTE_COMERCIAL', originId: { in: saleIds } } }),
    prisma.restaurantOrderItem.findMany({ where: { tenantId: demo.tenantId, orderId: { in: orderIds } } }),
    prisma.restaurantOrder.findMany({ where: { tenantId: demo.tenantId, id: { in: orderIds } } })
  ]);

  const goodContexts = contexts.filter((x) => !x.failed);
  const expectedOrders = goodContexts.length * ROUNDS;
  const expectedItems = expectedOrders * GUESTS;
  const expectedPayments = goodContexts.length * GUESTS;

  report.workload = {
    ...report.workload,
    tablesRequested: TABLES,
    tablesCompleted: goodContexts.length,
    roundsPerTable: ROUNDS,
    guestsPerTable: GUESTS,
    ordersExpected: expectedOrders,
    ordersStored: stressOrders.length,
    orderItemsExpected: expectedItems,
    orderItemsStored: stressItems.length,
    commandsProcessed: commands.length,
    paymentsExpected: expectedPayments,
    paymentsStored: payments.length,
    restaurantSessionPayments: sessionPayments.length,
    sales: sales.length,
    receivables: receivables.length,
    treasuryMovements: treasuryMovements.length,
    accountingJournals: journals.length,
    accountingLines: journals.reduce((sum, row) => sum + row.detalles.length, 0),
    inventoryMovements: inventoryMovements.length,
    consumptionRuns: consumptionRuns.length,
    dianDocumentsQueued: dianDocs.length
  };

  addInvariant('Sin errores operativos durante la carga', report.errors.length === 0, report.errors.length, 0);
  addInvariant('Todas las mesas terminan LIBRE', finalTables.every((x) => x.state === 'LIBRE'), finalTables.filter((x) => x.state !== 'LIBRE').length, 0);
  addInvariant('Todas las sesiones terminan CERRADA', finalSessions.every((x) => x.state === 'CERRADA'), finalSessions.filter((x) => x.state !== 'CERRADA').length, 0);
  addInvariant('Todos los pedidos de estrés fueron creados', stressOrders.length === expectedOrders, stressOrders.length, expectedOrders);
  addInvariant('Todas las líneas de pedido fueron creadas', stressItems.length === expectedItems, stressItems.length, expectedItems);
  addInvariant('Todas las comandas terminaron ENTREGADA', commands.length > 0 && (await prisma.restaurantCommand.count({ where: { tenantId: demo.tenantId, id: { in: commands.map((x) => x.id) }, state: { not: 'ENTREGADA' } } })) === 0, await prisma.restaurantCommand.count({ where: { tenantId: demo.tenantId, id: { in: commands.map((x) => x.id) }, state: { not: 'ENTREGADA' } } }), 0);
  addInvariant('Todas las ventas terminan PAGADO_TOTAL con saldo cero', sales.every((x) => x.estado === 'PAGADO_TOTAL' && money(x.saldo).eq(0)), sales.filter((x) => x.estado !== 'PAGADO_TOTAL' || !money(x.saldo).eq(0)).length, 0);
  addInvariant('Un registro de cartera por venta y todos PAGADA', receivables.length === sales.length && receivables.every((x) => x.estado === 'PAGADA' && money(x.saldo).eq(0)), `${receivables.length} / pendientes=${receivables.filter((x) => x.estado !== 'PAGADA' || !money(x.saldo).eq(0)).length}`, `${sales.length} / pendientes=0`);
  addInvariant('Todos los pagos parciales llegaron a Tesorería', payments.length === expectedPayments && treasuryMovements.length === expectedPayments, `${payments.length} pagos / ${treasuryMovements.length} movimientos`, `${expectedPayments} / ${expectedPayments}`);
  addInvariant('Todos los pagos quedaron registrados en la sesión Restaurante', sessionPayments.length === expectedPayments, sessionPayments.length, expectedPayments);
  addInvariant('Existe consumo de receta por cada venta', consumptionRuns.length === sales.length, consumptionRuns.length, sales.length);
  addInvariant('Documento fiscal encolado por cada venta', dianDocs.length === sales.length, dianDocs.length, sales.length, 'HIGH');

  const expectedJournalCount = sales.length + payments.length;
  addInvariant('Venta + cada recaudo generan asiento contable', journals.length === expectedJournalCount, journals.length, expectedJournalCount);
  const badJournals = journals.filter((journal) => {
    const debits = decimalSum(journal.detalles.map((x) => x.debito));
    const credits = decimalSum(journal.detalles.map((x) => x.credito));
    return !money(journal.totalDebito).eq(journal.totalCredito) || !debits.eq(credits) || !debits.eq(journal.totalDebito);
  });
  addInvariant('Todos los asientos cumplen partida doble', badJournals.length === 0, badJournals.length, 0);
  const globalDebit = decimalSum(journals.map((x) => x.totalDebito));
  const globalCredit = decimalSum(journals.map((x) => x.totalCredito));
  addInvariant('Débitos globales = créditos globales', globalDebit.eq(globalCredit), globalDebit.toString(), globalCredit.toString());

  const salesTotal = decimalSum(sales.map((x) => x.total));
  const paymentTotal = decimalSum(payments.map((x) => x.monto));
  const treasuryTotal = decimalSum(treasuryMovements.map((x) => x.monto));
  addInvariant('Total vendido = total recaudado', salesTotal.eq(paymentTotal), paymentTotal.toString(), salesTotal.toString());
  addInvariant('Total de movimientos Tesorería = total recaudado', treasuryTotal.eq(paymentTotal), treasuryTotal.toString(), paymentTotal.toString());

  const cashPayments = decimalSum(payments.filter((x) => x.cajaBancoId === cash.id).map((x) => x.monto));
  const bankPayments = decimalSum(payments.filter((x) => x.cajaBancoId === bank.id).map((x) => x.monto));
  const cashFinal = finalAccounts.find((x) => x.id === cash.id);
  const bankFinal = finalAccounts.find((x) => x.id === bank.id);
  addInvariant('Saldo de Caja conserva todos los recaudos concurrentes', money(cashFinal?.saldoActual || 0).eq(cashPayments), String(cashFinal?.saldoActual || 0), cashPayments.toString());
  addInvariant('Saldo de Banco conserva todos los recaudos concurrentes', money(bankFinal?.saldoActual || 0).eq(bankPayments), String(bankFinal?.saldoActual || 0), bankPayments.toString());
  addInvariant('Turno de Caja coincide con recaudos en efectivo', money(shiftRow?.ingresosEfectivo || 0).eq(cashPayments), String(shiftRow?.ingresosEfectivo || 0), cashPayments.toString());

  const movementByProduct = new Map();
  for (const movement of inventoryMovements) {
    movementByProduct.set(movement.productoId, qty(movementByProduct.get(movement.productoId) || 0).plus(movement.cantidad));
  }
  const inventoryMismatches = [];
  for (const product of finalIngredients) {
    const baseline = ingredientBaseline.get(product.id);
    const consumed = qty(movementByProduct.get(product.id) || 0);
    const expected = qty(baseline.stock.minus(consumed));
    if (!qty(product.stockActual).eq(expected)) {
      inventoryMismatches.push({ sku: product.sku, actual: String(product.stockActual), expected: expected.toString(), consumed: consumed.toString() });
    }
  }
  addInvariant('Stock final = stock inicial - consumos de todas las ventas', inventoryMismatches.length === 0, inventoryMismatches, 'sin diferencias');

  const duplicateSources = await prisma.asientoContable.groupBy({
    by: ['sourceId'],
    where: { tenantId: demo.tenantId, comprobanteId: { in: journalDocumentIds }, sourceId: { not: null } },
    _count: { _all: true },
    having: { sourceId: { _count: { gt: 1 } } }
  }).catch(() => []);
  addInvariant('Sin asientos automáticos duplicados por sourceId', duplicateSources.length === 0, duplicateSources.length, 0);

  report.totals = {
    sales: salesTotal.toString(),
    payments: paymentTotal.toString(),
    treasuryMovements: treasuryTotal.toString(),
    cashExpected: cashPayments.toString(),
    cashActual: String(cashFinal?.saldoActual || 0),
    bankExpected: bankPayments.toString(),
    bankActual: String(bankFinal?.saldoActual || 0),
    journalDebits: globalDebit.toString(),
    journalCredits: globalCredit.toString()
  };
  report.inventoryMismatches = inventoryMismatches;
  report.verdict = report.invariants.some((x) => !x.ok && x.severity === 'CRITICAL') || report.errors.length ? 'FAIL' : 'PASS';
  report.durationMs = Date.now() - overallStart;
}

function markdown() {
  const timing = timingSummary();
  const inv = report.invariants.map((row) => `| ${row.ok ? 'OK' : 'FALLA'} | ${row.severity} | ${row.name} | ${JSON.stringify(row.actual)} | ${JSON.stringify(row.expected)} |`).join('\n');
  const errors = report.errors.slice(0, 50).map((e) => `| ${e.phase} | ${e.target} | ${e.code} | ${String(e.message).replace(/\|/g, '\\|')} |`).join('\n') || '| - | - | - | Sin errores |';
  const timingRows = Object.entries(timing).map(([name, row]) => `| ${name} | ${row.count} | ${row.avgMs} | ${row.p95Ms} | ${row.maxMs} |`).join('\n');
  return `# Informe Stress Masivo Restaurante → Contabilidad\n\n**Stress ID:** ${report.stressId}  \n**Veredicto:** **${report.verdict}**  \n**Duración:** ${(report.durationMs / 1000).toFixed(2)} s  \n**Configuración:** ${report.configuration.tables} mesas × ${report.configuration.rounds} rondas × ${report.configuration.guestsPerTable} personas, concurrencia ${report.configuration.concurrency}.\n\n## Carga ejecutada\n\n\`\`\`json\n${JSON.stringify(report.workload, null, 2)}\n\`\`\`\n\n## Conciliación monetaria\n\n\`\`\`json\n${JSON.stringify(report.totals || {}, null, 2)}\n\`\`\`\n\n## Invariantes\n\n| Resultado | Severidad | Control | Actual | Esperado |\n|---|---|---|---|---|\n${inv}\n\n## Errores operativos\n\n| Fase | Objetivo | Código | Error |\n|---|---|---|---|\n${errors}\n\n## Latencias\n\n| Operación | N | Promedio ms | P95 ms | Máximo ms |\n|---|---:|---:|---:|---:|\n${timingRows}\n\n## Diferencias de inventario\n\n\`\`\`json\n${JSON.stringify(report.inventoryMismatches || [], null, 2)}\n\`\`\`\n`;
}

async function finish(error = null) {
  if (error) {
    report.errors.push(errorData('fatal', { id: STRESS_ID }, error));
    report.verdict = 'FAIL';
  }
  if (!report.finishedAt) report.finishedAt = new Date().toISOString();
  if (!report.durationMs) report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  report.timingSummary = timingSummary();
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(REPORT_MD, markdown());
  console.log(`RESTAURANT_MASSIVE_STRESS_VERDICT=${report.verdict}`);
  console.log(`RESTAURANT_MASSIVE_STRESS_JSON=${REPORT_JSON}`);
  console.log(`RESTAURANT_MASSIVE_STRESS_MD=${REPORT_MD}`);
  console.log(JSON.stringify({ verdict: report.verdict, configuration: report.configuration, workload: report.workload, totals: report.totals, findings: report.findings, errors: report.errors.slice(0, 10), timingSummary: report.timingSummary }, null, 2));
}

main()
  .then(async () => { report.finishedAt = new Date().toISOString(); await finish(); if (report.verdict !== 'PASS') process.exitCode = 1; })
  .catch(async (error) => { await finish(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
