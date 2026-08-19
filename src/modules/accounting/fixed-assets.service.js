const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money } = require('../../utils/decimal');
const accounting = require('./accounting.service');
const { auditInTx } = require('./accounting-audit.service');

async function validateAccounts(tx, tenantId, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const count = await tx.cuentaPUC.count({ where: { tenantId, id: { in: unique }, activa: true, permiteMovimiento: true } });
  if (count !== unique.length) throw new AppError(400, 'Cuenta contable inválida para activo fijo', 'FIXED_ASSET_ACCOUNT_INVALID');
}

async function listAssets(tenantId) {
  return prisma.activoFijo.findMany({
    where: { tenantId },
    include: {
      tercero: { select: { id: true, identificacion: true, nombre: true } },
      cuentaActivo: { select: { id: true, codigo: true, nombre: true } },
      cuentaDepAcumulada: { select: { id: true, codigo: true, nombre: true } },
      cuentaGastoDepreciacion: { select: { id: true, codigo: true, nombre: true } },
      depreciaciones: { select: { id: true, anio: true, mes: true, valor: true, asientoId: true, generadoEn: true }, orderBy: [{ anio: 'desc' }, { mes: 'desc' }] }
    },
    orderBy: [{ estado: 'asc' }, { codigo: 'asc' }]
  });
}

async function createAsset(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    await validateAccounts(tx, tenantId, [input.cuentaActivoId, input.cuentaDepAcumuladaId, input.cuentaGastoDepreciacionId]);
    if (input.terceroId) {
      const third = await tx.tercero.findFirst({ where: { id: input.terceroId, tenantId, activo: true } });
      if (!third) throw new AppError(400, 'Proveedor/tercero inválido', 'FIXED_ASSET_THIRD_PARTY_INVALID');
    }
    if (decimal(input.valorAdquisicion).lte(0) || decimal(input.valorResidual || 0).lt(0) || decimal(input.valorResidual || 0).gte(input.valorAdquisicion)) {
      throw new AppError(400, 'Valor de adquisición/residual inválido', 'FIXED_ASSET_VALUE_INVALID');
    }
    if (Number(input.vidaUtilMeses) < 1) throw new AppError(400, 'Vida útil inválida', 'FIXED_ASSET_LIFE_INVALID');
    let asset;
    try {
      asset = await tx.activoFijo.create({
        data: {
          tenantId,
          codigo: String(input.codigo).trim().toUpperCase(),
          nombre: input.nombre,
          terceroId: input.terceroId || null,
          valorAdquisicion: input.valorAdquisicion,
          valorResidual: input.valorResidual || 0,
          fechaCompra: input.fechaCompra,
          fechaInicioDepreciacion: input.fechaInicioDepreciacion || input.fechaCompra,
          vidaUtilMeses: input.vidaUtilMeses,
          metodo: 'LINEA_RECTA',
          cuentaActivoId: input.cuentaActivoId,
          cuentaDepAcumuladaId: input.cuentaDepAcumuladaId,
          cuentaGastoDepreciacionId: input.cuentaGastoDepreciacionId,
          estado: 'ACTIVO'
        }
      });
    } catch (error) {
      if (error?.code === 'P2002') throw new AppError(409, 'El código de activo fijo ya existe', 'FIXED_ASSET_EXISTS');
      throw error;
    }
    await auditInTx(tx, { tenantId, userId, entidad: 'ACTIVO', entidadId: asset.id, accion: 'CREAR', metadata: { codigo: asset.codigo, valor: asset.valorAdquisicion.toString() } });
    return asset;
  });
}

function monthIndex(date) {
  const d = new Date(date);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

async function generateDepreciation(tenantId, userId, assetId, anio, mes) {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new AppError(400, 'Periodo de depreciación inválido', 'FIXED_ASSET_PERIOD_INVALID');
  return prisma.$transaction(async (tx) => {
    const asset = await tx.activoFijo.findFirst({ where: { id: assetId, tenantId, estado: 'ACTIVO' } });
    if (!asset) throw new AppError(404, 'Activo fijo no encontrado', 'FIXED_ASSET_NOT_FOUND');
    const existing = await tx.depreciacionActivo.findUnique({ where: { activoFijoId_anio_mes: { activoFijoId: asset.id, anio, mes } }, include: { asiento: true } });
    if (existing) return existing;

    const targetIndex = anio * 12 + (mes - 1);
    const startIndex = monthIndex(asset.fechaInicioDepreciacion);
    const elapsed = targetIndex - startIndex;
    if (elapsed < 0) throw new AppError(409, 'El periodo es anterior al inicio de depreciación', 'FIXED_ASSET_BEFORE_START');
    if (elapsed >= asset.vidaUtilMeses) throw new AppError(409, 'La vida útil del activo ya terminó para este periodo', 'FIXED_ASSET_LIFE_FINISHED');

    const base = decimal(asset.valorAdquisicion).minus(asset.valorResidual);
    const monthly = money(base.div(asset.vidaUtilMeses));
    const already = await tx.depreciacionActivo.aggregate({ where: { tenantId, activoFijoId: asset.id }, _sum: { valor: true } });
    const remaining = money(base.minus(already._sum.valor || 0));
    const value = remaining.lt(monthly) ? remaining : monthly;
    if (value.lte(0)) throw new AppError(409, 'El activo ya está totalmente depreciado', 'FIXED_ASSET_FULLY_DEPRECIATED');

    const date = new Date(Date.UTC(anio, mes, 0, 23, 59, 59, 999));
    const journal = await accounting.createJournalInTx(tx, {
      tenantId,
      userId,
      fecha: date,
      concepto: `Depreciación ${asset.codigo} ${anio}-${String(mes).padStart(2, '0')}`,
      origen: 'DEPRECIACION',
      codigoTipo: 'DP',
      sourceId: `DEP-${asset.id}-${anio}-${mes}`,
      detalles: [
        { cuentaId: asset.cuentaGastoDepreciacionId, debito: value, credito: 0, concepto: `Gasto depreciación ${asset.nombre}` },
        { cuentaId: asset.cuentaDepAcumuladaId, debito: 0, credito: value, concepto: `Depreciación acumulada ${asset.nombre}` }
      ]
    });
    const dep = await tx.depreciacionActivo.create({
      data: { tenantId, activoFijoId: asset.id, asientoId: journal.id, generadoPorId: userId, anio, mes, valor: value }
    });
    await auditInTx(tx, { tenantId, userId, entidad: 'ACTIVO', entidadId: asset.id, accion: 'DEPRECIAR', metadata: { anio, mes, valor: value.toString(), asientoId: journal.id } });
    return { ...dep, asiento: journal };
  }, { timeout: 30000 });
}

module.exports = { listAssets, createAsset, generateDepreciation };
