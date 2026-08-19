const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money } = require('../../utils/decimal');

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const raw = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    : new Date(raw);
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'Fecha contable inválida', 'ACCOUNTING_DATE_INVALID');
  return d;
}

function rangeWhere(desde, hasta) {
  const fecha = {};
  const start = parseDate(desde, false);
  const end = parseDate(hasta, true);
  if (start) fecha.gte = start;
  if (end) fecha.lte = end;
  return Object.keys(fecha).length ? fecha : undefined;
}

function postedJournalFilter(extra = {}) {
  return { estado: { in: ['CONTABILIZADO', 'ANULADO'] }, ...extra };
}

function normalBalance(account, debit, credit) {
  return account.naturaleza === 'DEBITO'
    ? money(decimal(debit).minus(credit))
    : money(decimal(credit).minus(debit));
}

function absNumber(v) {
  return Math.abs(Number(v || 0));
}

function previousEquivalent(desde, hasta) {
  const start = parseDate(desde, false);
  const end = parseDate(hasta, true);
  if (!start || !end) return null;
  const duration = end.getTime() - start.getTime() + 1;
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - duration + 1);
  return { desde: prevStart.toISOString(), hasta: prevEnd.toISOString() };
}

function compareValue(actual, previous) {
  const a = Number(actual || 0);
  const p = Number(previous || 0);
  const variacion = a - p;
  return { actual: a, anterior: p, variacion, variacionPct: p === 0 ? null : (variacion / Math.abs(p)) * 100 };
}

async function loadDetailRows(tenantId, { desde, hasta, corte, excludeClosing = false, accountWhere = {} } = {}) {
  const fecha = corte
    ? { lte: parseDate(corte, true) }
    : rangeWhere(desde, hasta);
  const asiento = postedJournalFilter({});
  if (fecha) asiento.fecha = fecha;
  if (excludeClosing) asiento.origen = { not: 'CIERRE' };

  return prisma.detalleAsiento.findMany({
    where: {
      tenantId,
      cuenta: { tenantId, ...accountWhere },
      asiento
    },
    include: {
      cuenta: {
        select: {
          id: true,
          codigo: true,
          nombre: true,
          nivel: true,
          naturaleza: true,
          clasificacionESF: true,
          categoriaResultado: true
        }
      },
      asiento: { select: { id: true, fecha: true, estado: true, origen: true, numeroComprobante: true, referencia: true, concepto: true } }
    },
    orderBy: [{ asiento: { fecha: 'asc' } }, { creadoEn: 'asc' }]
  });
}

function aggregateByAccount(rows) {
  const map = new Map();
  for (const row of rows) {
    let x = map.get(row.cuentaId);
    if (!x) {
      x = { cuenta: row.cuenta, debito: decimal(0), credito: decimal(0) };
      map.set(row.cuentaId, x);
    }
    x.debito = x.debito.plus(row.debito);
    x.credito = x.credito.plus(row.credito);
  }
  return [...map.values()].map((x) => ({
    cuenta: x.cuenta,
    debito: money(x.debito),
    credito: money(x.credito),
    saldo: normalBalance(x.cuenta, x.debito, x.credito)
  })).sort((a, b) => a.cuenta.codigo.localeCompare(b.cuenta.codigo));
}

async function trialBalance(tenantId, filters = {}) {
  const rows = await loadDetailRows(tenantId, { desde: filters.desde, hasta: filters.hasta });
  const cuentas = aggregateByAccount(rows);
  let totalDebito = decimal(0);
  let totalCredito = decimal(0);
  for (const row of rows) {
    totalDebito = totalDebito.plus(row.debito);
    totalCredito = totalCredito.plus(row.credito);
  }
  const result = {
    desde: filters.desde || null,
    hasta: filters.hasta || null,
    cuentas,
    totalDebito: money(totalDebito),
    totalCredito: money(totalCredito),
    diferencia: money(totalDebito.minus(totalCredito)),
    cuadra: money(totalDebito).eq(money(totalCredito))
  };
  if (filters.comparar && filters.desde && filters.hasta) {
    const prevRange = previousEquivalent(filters.desde, filters.hasta);
    const prev = await trialBalance(tenantId, { ...prevRange, comparar: false });
    result.comparativo = {
      periodoAnterior: prevRange,
      totalDebito: compareValue(result.totalDebito, prev.totalDebito),
      totalCredito: compareValue(result.totalCredito, prev.totalCredito)
    };
  }
  return result;
}

async function profitAndLoss(tenantId, filters = {}) {
  const rows = await loadDetailRows(tenantId, {
    desde: filters.desde,
    hasta: filters.hasta,
    excludeClosing: true,
    accountWhere: { categoriaResultado: { not: null } }
  });
  const accounts = aggregateByAccount(rows);
  const buckets = {
    INGRESO_OPERACIONAL: [], COSTO_VENTAS: [], GASTO_ADMINISTRACION: [], GASTO_VENTAS: [],
    INGRESO_NO_OPERACIONAL: [], GASTO_NO_OPERACIONAL: [], IMPUESTO_RENTA: []
  };
  for (const row of accounts) {
    const key = row.cuenta.categoriaResultado;
    if (key && buckets[key]) buckets[key].push({ ...row, valor: money(row.saldo) });
  }
  const sum = (key) => money(buckets[key].reduce((acc, x) => acc.plus(x.valor), decimal(0)));
  const ingresosOperacionales = sum('INGRESO_OPERACIONAL');
  const costoVentas = sum('COSTO_VENTAS');
  const utilidadBruta = money(ingresosOperacionales.minus(costoVentas));
  const gastosAdministracion = sum('GASTO_ADMINISTRACION');
  const gastosVentas = sum('GASTO_VENTAS');
  const utilidadOperacional = money(utilidadBruta.minus(gastosAdministracion).minus(gastosVentas));
  const ingresosNoOperacionales = sum('INGRESO_NO_OPERACIONAL');
  const gastosNoOperacionales = sum('GASTO_NO_OPERACIONAL');
  const utilidadAntesImpuestos = money(utilidadOperacional.plus(ingresosNoOperacionales).minus(gastosNoOperacionales));

  const config = await prisma.configuracionContable.findUnique({ where: { tenantId } });
  const impuestoContabilizado = sum('IMPUESTO_RENTA');
  const tasa = decimal(config?.tasaImpuestoRenta || 0);
  const usarEstimado = impuestoContabilizado.eq(0) && tasa.gt(0) && utilidadAntesImpuestos.gt(0);
  const impuestoRenta = usarEstimado
    ? money(utilidadAntesImpuestos.mul(tasa).div(100))
    : impuestoContabilizado;
  const utilidadNeta = money(utilidadAntesImpuestos.minus(impuestoRenta));

  const result = {
    desde: filters.desde || null,
    hasta: filters.hasta || null,
    cuentas: buckets,
    ingresosOperacionales,
    costoVentas,
    utilidadBruta,
    gastosAdministracion,
    gastosVentas,
    utilidadOperacional,
    ingresosNoOperacionales,
    gastosNoOperacionales,
    utilidadAntesImpuestos,
    impuestoRenta,
    impuestoEstimado: usarEstimado,
    tasaImpuestoRenta: tasa,
    utilidadNeta
  };

  if (filters.comparar && filters.desde && filters.hasta) {
    const prevRange = previousEquivalent(filters.desde, filters.hasta);
    const prev = await profitAndLoss(tenantId, { ...prevRange, comparar: false });
    result.comparativo = {
      periodoAnterior: prevRange,
      ingresosOperacionales: compareValue(ingresosOperacionales, prev.ingresosOperacionales),
      utilidadBruta: compareValue(utilidadBruta, prev.utilidadBruta),
      utilidadOperacional: compareValue(utilidadOperacional, prev.utilidadOperacional),
      utilidadAntesImpuestos: compareValue(utilidadAntesImpuestos, prev.utilidadAntesImpuestos),
      utilidadNeta: compareValue(utilidadNeta, prev.utilidadNeta)
    };
  }
  return result;
}

async function openResultStart(tenantId, cutoff) {
  const d = parseDate(cutoff, true);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const current = await prisma.periodoContable.findUnique({ where: { tenantId_anio_mes: { tenantId, anio: year, mes: month } } });
  if (current?.estado === 'CERRADO') return { closed: true, start: null };
  const latestClosed = await prisma.periodoContable.findFirst({
    where: { tenantId, anio: year, mes: { lt: month }, estado: 'CERRADO' },
    orderBy: { mes: 'desc' }
  });
  const startMonthIndex = latestClosed ? latestClosed.mes : 0;
  return { closed: false, start: new Date(Date.UTC(year, startMonthIndex, 1, 0, 0, 0, 0)) };
}

async function balanceSheet(tenantId, filters = {}) {
  if (!filters.corte) throw new AppError(400, 'La fecha de corte es obligatoria', 'ACCOUNTING_CUTOFF_REQUIRED');
  const rows = await loadDetailRows(tenantId, {
    corte: filters.corte,
    accountWhere: { clasificacionESF: { in: ['ACTIVO_CORRIENTE', 'ACTIVO_NO_CORRIENTE', 'PASIVO_CORRIENTE', 'PASIVO_NO_CORRIENTE', 'PATRIMONIO'] } }
  });
  const accounts = aggregateByAccount(rows);
  const groups = {
    ACTIVO_CORRIENTE: [], ACTIVO_NO_CORRIENTE: [], PASIVO_CORRIENTE: [], PASIVO_NO_CORRIENTE: [], PATRIMONIO: []
  };
  for (const x of accounts) if (groups[x.cuenta.clasificacionESF]) groups[x.cuenta.clasificacionESF].push(x);
  const sum = (key) => money(groups[key].reduce((acc, x) => acc.plus(x.saldo), decimal(0)));
  const activoCorriente = sum('ACTIVO_CORRIENTE');
  const activoNoCorriente = sum('ACTIVO_NO_CORRIENTE');
  const pasivoCorriente = sum('PASIVO_CORRIENTE');
  const pasivoNoCorriente = sum('PASIVO_NO_CORRIENTE');
  let patrimonio = sum('PATRIMONIO');
  let utilidadEjercicioNoCerrada = money(0);
  let impuestoEstimadoNoContabilizado = money(0);

  const open = await openResultStart(tenantId, filters.corte);
  if (!open.closed && open.start) {
    const pnl = await profitAndLoss(tenantId, { desde: open.start.toISOString(), hasta: filters.corte, comparar: false });
    utilidadEjercicioNoCerrada = money(pnl.utilidadNeta);
    if (pnl.impuestoEstimado) impuestoEstimadoNoContabilizado = money(pnl.impuestoRenta);
  }
  patrimonio = money(patrimonio.plus(utilidadEjercicioNoCerrada));
  const totalActivo = money(activoCorriente.plus(activoNoCorriente));
  const totalPasivo = money(pasivoCorriente.plus(pasivoNoCorriente).plus(impuestoEstimadoNoContabilizado));
  const totalPasivoPatrimonio = money(totalPasivo.plus(patrimonio));
  const diferencia = money(totalActivo.minus(totalPasivoPatrimonio));

  const result = {
    corte: filters.corte,
    grupos,
    activoCorriente,
    activoNoCorriente,
    totalActivo,
    pasivoCorriente,
    pasivoNoCorriente,
    impuestoEstimadoNoContabilizado,
    totalPasivo,
    patrimonio,
    utilidadEjercicioNoCerrada,
    totalPasivoPatrimonio,
    diferencia,
    cuadra: absNumber(diferencia) < 0.01
  };

  if (filters.comparar) {
    const currentCutoff = parseDate(filters.corte, true);
    const prevCutoff = new Date(currentCutoff);
    prevCutoff.setUTCMonth(prevCutoff.getUTCMonth() - 1);
    const prev = await balanceSheet(tenantId, { corte: prevCutoff.toISOString(), comparar: false });
    result.comparativo = {
      corteAnterior: prevCutoff.toISOString(),
      totalActivo: compareValue(totalActivo, prev.totalActivo),
      totalPasivo: compareValue(totalPasivo, prev.totalPasivo),
      patrimonio: compareValue(patrimonio, prev.patrimonio)
    };
  }
  return result;
}

module.exports = {
  parseDate,
  rangeWhere,
  postedJournalFilter,
  normalBalance,
  aggregateByAccount,
  loadDetailRows,
  trialBalance,
  profitAndLoss,
  balanceSheet,
  previousEquivalent,
  compareValue
};
