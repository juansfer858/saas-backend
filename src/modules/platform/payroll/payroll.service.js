const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');
const { money } = require('../../../utils/decimal');
const accounting = require('../../accounting/accounting.service');
const dian = require('../dian/dian.service');

async function listEmployees(tenantId) {
  const rows = await prisma.payrollEmployee.findMany({ where: { tenantId }, orderBy: { employeeCode: 'asc' } });
  const thirdIds = rows.map((x) => x.terceroId);
  const thirds = thirdIds.length ? await prisma.tercero.findMany({ where: { tenantId, id: { in: thirdIds } } }) : [];
  const byId = new Map(thirds.map((x) => [x.id, x]));
  return rows.map((row) => ({ ...row, tercero: byId.get(row.terceroId) || null }));
}

async function saveEmployee(tenantId, input) {
  const tercero = await prisma.tercero.findFirst({ where: { id: input.terceroId, tenantId, activo: true } });
  if (!tercero) throw new AppError(400, 'El empleado debe corresponder a un tercero activo de la empresa', 'PAYROLL_THIRD_PARTY_INVALID');
  if (!['EMPLEADO', 'OTRO'].includes(tercero.tipo)) {
    await prisma.tercero.update({ where: { id: tercero.id }, data: { tipo: 'EMPLEADO' } });
  }
  return prisma.payrollEmployee.upsert({
    where: { tenantId_terceroId: { tenantId, terceroId: input.terceroId } },
    create: {
      tenantId,
      terceroId: input.terceroId,
      employeeCode: input.employeeCode,
      contractType: input.contractType,
      baseSalary: money(input.baseSalary),
      startDate: input.startDate,
      endDate: input.endDate || null,
      paymentMethod: input.paymentMethod || null,
      bankAccountMasked: input.bankAccountMasked || null,
      active: input.active !== false
    },
    update: {
      employeeCode: input.employeeCode,
      contractType: input.contractType,
      baseSalary: money(input.baseSalary),
      startDate: input.startDate,
      endDate: input.endDate || null,
      paymentMethod: input.paymentMethod || null,
      bankAccountMasked: input.bankAccountMasked || null,
      active: input.active !== false
    }
  });
}

async function saveConfig(tenantId, userId, input) {
  const accountIds = [input.expenseAccountId, input.payableAccountId, input.contributionAccountId].filter(Boolean);
  if (accountIds.length) {
    const count = await prisma.cuentaPUC.count({ where: { tenantId, id: { in: accountIds }, activa: true, permiteMovimiento: true } });
    if (count !== new Set(accountIds).size) throw new AppError(400, 'Una o más cuentas de nómina no pertenecen al PUC activo', 'PAYROLL_ACCOUNT_INVALID');
  }
  return prisma.payrollConfig.upsert({
    where: { tenantId },
    create: { tenantId, ...input, updatedByUserId: userId },
    update: { ...input, updatedByUserId: userId }
  });
}

async function getConfig(tenantId) {
  return prisma.payrollConfig.findUnique({ where: { tenantId } });
}

async function createPeriod(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payrollPeriod.findUnique({ where: { tenantId_year_month_frequency: { tenantId, year: input.year, month: input.month, frequency: input.frequency } } });
    if (existing) throw new AppError(409, 'Ya existe un periodo de nómina con esta frecuencia', 'PAYROLL_PERIOD_EXISTS');
    const employees = await tx.payrollEmployee.findMany({ where: { tenantId, id: { in: input.lines.map((x) => x.employeeId) }, active: true } });
    if (employees.length !== new Set(input.lines.map((x) => x.employeeId)).size) throw new AppError(400, 'Uno o más empleados no están activos', 'PAYROLL_EMPLOYEE_INVALID');
    const period = await tx.payrollPeriod.create({ data: { tenantId, year: input.year, month: input.month, frequency: input.frequency, state: 'BORRADOR', generatedByUserId: userId } });
    for (const line of input.lines) {
      const totalDevengado = money(line.totalDevengado);
      const totalDeducido = money(line.totalDeducido);
      const netoPagar = money(totalDevengado.minus(totalDeducido));
      if (totalDevengado.lte(0) || totalDeducido.lt(0) || netoPagar.lt(0)) throw new AppError(400, 'Valores de nómina inválidos', 'PAYROLL_VALUES_INVALID');
      await tx.payrollLine.create({
        data: {
          payrollPeriodId: period.id,
          tenantId,
          employeeId: line.employeeId,
          devengados: line.devengados || {},
          deducciones: line.deducciones || {},
          totalDevengado,
          totalDeducido,
          netoPagar
        }
      });
    }
    return tx.payrollPeriod.findUnique({ where: { id: period.id }, include: { lines: true } });
  });
}

async function listPeriods(tenantId) {
  return prisma.payrollPeriod.findMany({ where: { tenantId }, include: { lines: true }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
}

async function validatePayrollAccounts(tx, tenantId, config) {
  if (!config?.expenseAccountId || !config?.payableAccountId) throw new AppError(409, 'Configure las cuentas contables de nómina antes de generar', 'PAYROLL_ACCOUNTING_CONFIG_REQUIRED');
  const ids = [config.expenseAccountId, config.payableAccountId, config.contributionAccountId].filter(Boolean);
  const accounts = await tx.cuentaPUC.findMany({ where: { tenantId, id: { in: ids }, activa: true, permiteMovimiento: true } });
  if (accounts.length !== new Set(ids).size) throw new AppError(409, 'La parametrización contable de nómina contiene cuentas inválidas', 'PAYROLL_ACCOUNTING_CONFIG_INVALID');
}

async function generatePeriod(tenantId, userId, periodId) {
  return prisma.$transaction(async (tx) => {
    const period = await tx.payrollPeriod.findFirst({ where: { id: periodId, tenantId }, include: { lines: true } });
    if (!period) throw new AppError(404, 'Periodo de nómina no encontrado', 'PAYROLL_PERIOD_NOT_FOUND');
    if (period.state !== 'BORRADOR') throw new AppError(409, 'Solo una nómina en borrador puede generarse', 'PAYROLL_PERIOD_NOT_DRAFT');
    if (!period.lines.length) throw new AppError(400, 'La nómina no tiene empleados', 'PAYROLL_LINES_REQUIRED');
    const config = await tx.payrollConfig.findUnique({ where: { tenantId } });
    await validatePayrollAccounts(tx, tenantId, config);
    const employees = await tx.payrollEmployee.findMany({ where: { tenantId, id: { in: period.lines.map((x) => x.employeeId) } } });
    const byEmployee = new Map(employees.map((x) => [x.id, x]));
    const details = [];
    for (const line of period.lines) {
      const employee = byEmployee.get(line.employeeId);
      if (!employee) throw new AppError(409, 'Empleado de nómina no encontrado', 'PAYROLL_EMPLOYEE_INVALID');
      const gross = money(line.totalDevengado);
      const deductions = money(line.totalDeducido);
      const net = money(line.netoPagar);
      details.push({ cuentaId: config.expenseAccountId, terceroId: employee.terceroId, debito: gross, credito: 0, concepto: `Nómina ${period.year}-${String(period.month).padStart(2, '0')} ${employee.employeeCode}` });
      if (deductions.gt(0)) {
        if (!config.contributionAccountId) throw new AppError(409, 'Configure la cuenta de aportes/deducciones de nómina', 'PAYROLL_CONTRIBUTION_ACCOUNT_REQUIRED');
        details.push({ cuentaId: config.contributionAccountId, terceroId: employee.terceroId, debito: 0, credito: deductions, concepto: `Deducciones nómina ${employee.employeeCode}` });
      }
      if (net.gt(0)) details.push({ cuentaId: config.payableAccountId, terceroId: employee.terceroId, debito: 0, credito: net, concepto: `Neto nómina por pagar ${employee.employeeCode}` });
    }
    const journal = await accounting.createJournalInTx(tx, {
      tenantId,
      userId,
      sourceId: `PAYROLL-${period.id}`,
      fecha: new Date(Date.UTC(period.year, period.month - 1, 1)),
      concepto: `Nómina ${period.frequency} ${period.year}-${String(period.month).padStart(2, '0')}`,
      referencia: `NOM-${period.year}-${String(period.month).padStart(2, '0')}`,
      origen: 'AUTOMATICO',
      codigoTipo: 'AU',
      detalles: details
    });

    for (const line of period.lines) {
      const employee = byEmployee.get(line.employeeId);
      const doc = await dian.enqueueInTx(tx, {
        tenantId,
        documentType: 'NOMINA_ELECTRONICA',
        originType: 'PAYROLL_LINE',
        originId: line.id,
        internalNumber: `NOM-${period.year}-${period.month}-${employee.employeeCode}`,
        date: new Date(Date.UTC(period.year, period.month - 1, 1)),
        snapshot: {
          employeeCode: employee.employeeCode,
          terceroId: employee.terceroId,
          totalDevengado: String(line.totalDevengado),
          totalDeducido: String(line.totalDeducido),
          netoPagar: String(line.netoPagar),
          devengados: line.devengados,
          deducciones: line.deducciones
        }
      });
      if (doc) await tx.payrollLine.update({ where: { id: line.id }, data: { dianDocumentId: doc.id } });
    }
    await tx.payrollPeriod.update({ where: { id: period.id }, data: { state: 'GENERADO', generatedAt: new Date(), accountingJournalId: journal.id } });
    return tx.payrollPeriod.findUnique({ where: { id: period.id }, include: { lines: true } });
  });
}

async function syncTransmissionState(tenantId, periodId) {
  const period = await prisma.payrollPeriod.findFirst({ where: { id: periodId, tenantId }, include: { lines: true } });
  if (!period) throw new AppError(404, 'Periodo de nómina no encontrado', 'PAYROLL_PERIOD_NOT_FOUND');
  const ids = period.lines.map((x) => x.dianDocumentId).filter(Boolean);
  if (!ids.length) return period;
  const docs = await prisma.dianDocument.findMany({ where: { tenantId, id: { in: ids } } });
  if (docs.length === ids.length && docs.every((x) => x.state === 'ACEPTADO')) {
    return prisma.payrollPeriod.update({ where: { id: period.id }, data: { state: 'TRANSMITIDO' }, include: { lines: true } });
  }
  return period;
}

module.exports = { listEmployees, saveEmployee, saveConfig, getConfig, createPeriod, listPeriods, generatePeriod, syncTransmissionState };
