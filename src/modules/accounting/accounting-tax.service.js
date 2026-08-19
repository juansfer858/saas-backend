const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money } = require('../../utils/decimal');
const { auditInTx } = require('./accounting-audit.service');

async function listVatRates(tenantId) {
  return prisma.tarifaIVA.findMany({
    where: { tenantId },
    include: {
      cuentaGenerado: { select: { id: true, codigo: true, nombre: true } },
      cuentaDescontable: { select: { id: true, codigo: true, nombre: true } }
    },
    orderBy: [{ activa: 'desc' }, { porcentaje: 'desc' }, { codigo: 'asc' }]
  });
}

async function upsertVatRate(tenantId, userId, input, id = null) {
  return prisma.$transaction(async (tx) => {
    const ids = [input.cuentaGeneradoId, input.cuentaDescontableId].filter(Boolean);
    if (ids.length) {
      const count = await tx.cuentaPUC.count({ where: { tenantId, id: { in: [...new Set(ids)] }, activa: true, permiteMovimiento: true } });
      if (count !== new Set(ids).size) throw new AppError(400, 'Cuenta IVA inválida', 'ACCOUNTING_VAT_ACCOUNT_INVALID');
    }
    const data = {
      codigo: String(input.codigo).trim().toUpperCase(),
      nombre: input.nombre,
      porcentaje: input.porcentaje,
      categoria: input.categoria,
      cuentaGeneradoId: input.cuentaGeneradoId || null,
      cuentaDescontableId: input.cuentaDescontableId || null,
      activa: input.activa !== false
    };
    let rate;
    if (id) {
      const current = await tx.tarifaIVA.findFirst({ where: { id, tenantId } });
      if (!current) throw new AppError(404, 'Tarifa IVA no encontrada', 'ACCOUNTING_VAT_NOT_FOUND');
      rate = await tx.tarifaIVA.update({ where: { id }, data });
    } else {
      try { rate = await tx.tarifaIVA.create({ data: { tenantId, ...data } }); }
      catch (error) {
        if (error?.code === 'P2002') throw new AppError(409, 'El código de tarifa IVA ya existe', 'ACCOUNTING_VAT_EXISTS');
        throw error;
      }
    }
    await auditInTx(tx, { tenantId, userId, entidad: 'IMPUESTO', entidadId: rate.id, accion: id ? 'ACTUALIZAR_IVA' : 'CREAR_IVA', metadata: { codigo: rate.codigo, porcentaje: rate.porcentaje.toString() } });
    return rate;
  });
}

async function listRetentions(tenantId) {
  return prisma.conceptoRetencion.findMany({
    where: { tenantId },
    include: { cuenta: { select: { id: true, codigo: true, nombre: true } } },
    orderBy: [{ activo: 'desc' }, { tipo: 'asc' }, { codigo: 'asc' }]
  });
}

async function upsertRetention(tenantId, userId, input, id = null) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.cuentaPUC.findFirst({ where: { id: input.cuentaId, tenantId, activa: true, permiteMovimiento: true } });
    if (!account) throw new AppError(400, 'Cuenta de retención inválida', 'ACCOUNTING_RETENTION_ACCOUNT_INVALID');
    const data = {
      codigo: String(input.codigo).trim().toUpperCase(),
      nombre: input.nombre,
      tipo: input.tipo,
      porcentaje: input.porcentaje,
      baseMinima: input.baseMinima || 0,
      cuentaId: input.cuentaId,
      naturaleza: input.naturaleza,
      automatico: Boolean(input.automatico),
      activo: input.activo !== false
    };
    let concept;
    if (id) {
      const current = await tx.conceptoRetencion.findFirst({ where: { id, tenantId } });
      if (!current) throw new AppError(404, 'Concepto de retención no encontrado', 'ACCOUNTING_RETENTION_NOT_FOUND');
      concept = await tx.conceptoRetencion.update({ where: { id }, data });
    } else {
      try { concept = await tx.conceptoRetencion.create({ data: { tenantId, ...data } }); }
      catch (error) {
        if (error?.code === 'P2002') throw new AppError(409, 'El código de retención ya existe', 'ACCOUNTING_RETENTION_EXISTS');
        throw error;
      }
    }
    await auditInTx(tx, { tenantId, userId, entidad: 'IMPUESTO', entidadId: concept.id, accion: id ? 'ACTUALIZAR_RETENCION' : 'CREAR_RETENCION', metadata: { codigo: concept.codigo, tipo: concept.tipo, porcentaje: concept.porcentaje.toString() } });
    return concept;
  });
}

function thirdPartyApplies(tercero, tipo) {
  if (!tercero) return false;
  if (tipo === 'RETEFUENTE') return tercero.sujetoRetefuente;
  if (tipo === 'RETEICA') return tercero.sujetoReteIca;
  if (tipo === 'RETEIVA') return tercero.sujetoReteIva;
  return false;
}

function natureApplies(tipoOperacion, naturaleza) {
  return (tipoOperacion === 'COMPRA' && naturaleza === 'PAGAR') ||
    (tipoOperacion === 'VENTA' && naturaleza === 'COBRAR');
}

function retentionBase(concept, base, ivaValue) {
  return concept.tipo === 'RETEIVA' ? money(ivaValue || 0) : money(base);
}

async function calculateTaxesWithClient(client, tenantId, input) {
  const base = money(input.base);
  if (base.lt(0)) throw new AppError(400, 'La base no puede ser negativa', 'ACCOUNTING_TAX_BASE_INVALID');
  const tercero = input.tercero || (input.terceroId
    ? await client.tercero.findFirst({ where: { id: input.terceroId, tenantId, activo: true } })
    : null);
  if (input.terceroId && !tercero) throw new AppError(400, 'Tercero inválido', 'ACCOUNTING_THIRD_PARTY_INVALID');

  let iva = null;
  if (input.tarifaIvaId) {
    const rate = await client.tarifaIVA.findFirst({ where: { id: input.tarifaIvaId, tenantId, activa: true } });
    if (!rate) throw new AppError(400, 'Tarifa IVA inválida', 'ACCOUNTING_VAT_INVALID');
    const amount = rate.categoria === 'GRAVADO' ? money(base.mul(rate.porcentaje).div(100)) : money(0);
    const accountId = input.tipoOperacion === 'COMPRA' ? rate.cuentaDescontableId : rate.cuentaGeneradoId;
    if (amount.gt(0) && !accountId) throw new AppError(409, 'La tarifa IVA no tiene cuenta contable configurada', 'ACCOUNTING_VAT_ACCOUNT_REQUIRED');
    iva = {
      tarifaId: rate.id,
      codigo: rate.codigo,
      porcentaje: rate.porcentaje,
      categoria: rate.categoria,
      valor: amount,
      cuentaId: accountId,
      debito: input.tipoOperacion === 'COMPRA' ? amount : money(0),
      credito: input.tipoOperacion === 'VENTA' ? amount : money(0)
    };
  }

  const where = { tenantId, activo: true };
  const explicit = Array.isArray(input.conceptosRetencionIds) && input.conceptosRetencionIds.length > 0;
  if (explicit) where.id = { in: input.conceptosRetencionIds };
  else where.automatico = true;
  const concepts = await client.conceptoRetencion.findMany({ where, include: { cuenta: true } });
  const retenciones = [];
  const ivaValue = input.ivaValue !== undefined && input.ivaValue !== null ? money(input.ivaValue) : money(iva?.valor || 0);

  for (const c of concepts) {
    if (!natureApplies(input.tipoOperacion, c.naturaleza)) continue;
    if (!explicit && !thirdPartyApplies(tercero, c.tipo)) continue;
    const baseAplicada = retentionBase(c, base, ivaValue);
    if (baseAplicada.lt(c.baseMinima)) continue;
    const value = money(baseAplicada.mul(c.porcentaje).div(100));
    if (value.eq(0)) continue;
    const payable = c.naturaleza === 'PAGAR';
    retenciones.push({
      conceptoId: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      porcentaje: c.porcentaje,
      baseMinima: c.baseMinima,
      baseAplicada,
      naturaleza: c.naturaleza,
      valor: value,
      cuentaId: c.cuentaId,
      debito: payable ? money(0) : value,
      credito: payable ? value : money(0)
    });
  }
  const totalRetenciones = money(retenciones.reduce((a, r) => a.plus(r.valor), decimal(0)));
  return { base, iva, retenciones, totalRetenciones, tercero };
}

async function calculateTaxes(tenantId, input) {
  return calculateTaxesWithClient(prisma, tenantId, input);
}

async function calculateCommercialRetentionsInTx(tx, tenantId, params) {
  const result = await calculateTaxesWithClient(tx, tenantId, {
    tercero: params.tercero,
    terceroId: params.tercero?.id || null,
    tipoOperacion: params.tipoOperacion,
    base: params.subtotal,
    ivaValue: params.ivaTotal,
    conceptosRetencionIds: undefined
  });
  const gross = money(params.total);
  const neto = money(gross.minus(result.totalRetenciones));
  if (neto.lt(0)) {
    throw new AppError(409, 'Las retenciones configuradas superan el total del documento', 'ACCOUNTING_RETENTION_EXCEEDS_TOTAL', {
      total: gross.toString(),
      retenciones: result.totalRetenciones.toString()
    });
  }
  return { ...result, totalBruto: gross, neto };
}

async function createFiscalJournal(tenantId, userId, input) {
  const accounting = require('./accounting.service');
  return prisma.$transaction(async (tx) => {
    const [baseAccount, settlementAccount] = await Promise.all([
      tx.cuentaPUC.findFirst({ where: { id: input.cuentaBaseId, tenantId, activa: true, permiteMovimiento: true } }),
      tx.cuentaPUC.findFirst({ where: { id: input.cuentaContrapartidaId, tenantId, activa: true, permiteMovimiento: true } })
    ]);
    if (!baseAccount || !settlementAccount) throw new AppError(400, 'Cuenta base/contrapartida inválida', 'ACCOUNTING_FISCAL_ACCOUNT_INVALID');

    const tax = await calculateTaxesWithClient(tx, tenantId, input);
    const details = [];
    const base = money(input.base);
    if (input.tipoOperacion === 'COMPRA') {
      details.push({ cuentaId: baseAccount.id, terceroId: input.terceroId || null, debito: base, credito: 0, concepto: 'Base compra' });
    } else {
      details.push({ cuentaId: baseAccount.id, terceroId: input.terceroId || null, debito: 0, credito: base, concepto: 'Base venta' });
    }
    if (tax.iva && money(tax.iva.valor).gt(0)) {
      details.push({
        cuentaId: tax.iva.cuentaId,
        terceroId: input.terceroId || null,
        tarifaIvaId: tax.iva.tarifaId,
        debito: tax.iva.debito,
        credito: tax.iva.credito,
        concepto: `${tax.iva.codigo} ${tax.iva.porcentaje}%`
      });
    }
    for (const r of tax.retenciones) {
      details.push({
        cuentaId: r.cuentaId,
        terceroId: input.terceroId || null,
        conceptoRetencionId: r.conceptoId,
        debito: r.debito,
        credito: r.credito,
        concepto: `${r.codigo} ${r.porcentaje}%`
      });
    }

    let debit = decimal(0);
    let credit = decimal(0);
    for (const line of details) {
      debit = debit.plus(line.debito || 0);
      credit = credit.plus(line.credito || 0);
    }
    const delta = money(debit.minus(credit));
    if (delta.eq(0)) throw new AppError(409, 'El asiento fiscal no requiere contrapartida', 'ACCOUNTING_FISCAL_SETTLEMENT_ZERO');
    if (delta.gt(0)) details.push({ cuentaId: settlementAccount.id, terceroId: input.terceroId || null, debito: 0, credito: delta, concepto: 'Contrapartida neta fiscal' });
    else details.push({ cuentaId: settlementAccount.id, terceroId: input.terceroId || null, debito: delta.abs(), credito: 0, concepto: 'Contrapartida neta fiscal' });

    return accounting.createJournalInTx(tx, {
      tenantId,
      userId,
      fecha: input.fecha || new Date(),
      concepto: input.concepto,
      tipoComprobanteId: input.tipoComprobanteId || null,
      origen: 'MANUAL',
      detalles: details
    });
  });
}

module.exports = {
  listVatRates,
  upsertVatRate,
  listRetentions,
  upsertRetention,
  thirdPartyApplies,
  natureApplies,
  retentionBase,
  calculateTaxesWithClient,
  calculateTaxes,
  calculateCommercialRetentionsInTx,
  createFiscalJournal
};
