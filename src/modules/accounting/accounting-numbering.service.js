const { AppError } = require('../../utils/app-error');

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

async function listVoucherTypes(client, tenantId) {
  return client.tipoComprobanteContable.findMany({
    where: { tenantId },
    orderBy: [{ activo: 'desc' }, { codigo: 'asc' }]
  });
}

async function createVoucherType(client, tenantId, input) {
  try {
    return await client.tipoComprobanteContable.create({
      data: {
        tenantId,
        codigo: normalizeCode(input.codigo),
        nombre: input.nombre,
        consecutivoPorPeriodo: input.consecutivoPorPeriodo !== false,
        sistema: false,
        activo: input.activo !== false
      }
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'El código del tipo de comprobante ya existe', 'ACCOUNTING_VOUCHER_TYPE_EXISTS');
    throw error;
  }
}

async function updateVoucherType(client, tenantId, id, input) {
  const current = await client.tipoComprobanteContable.findFirst({ where: { id, tenantId } });
  if (!current) throw new AppError(404, 'Tipo de comprobante no encontrado', 'ACCOUNTING_VOUCHER_TYPE_NOT_FOUND');
  const data = {};
  if (input.nombre !== undefined) data.nombre = input.nombre;
  if (input.activo !== undefined) data.activo = Boolean(input.activo);
  if (input.consecutivoPorPeriodo !== undefined) data.consecutivoPorPeriodo = Boolean(input.consecutivoPorPeriodo);
  if (input.codigo !== undefined) {
    if (current.sistema) throw new AppError(409, 'El código de un tipo de sistema no se puede cambiar', 'ACCOUNTING_SYSTEM_VOUCHER_TYPE');
    data.codigo = normalizeCode(input.codigo);
  }
  try {
    return await client.tipoComprobanteContable.update({ where: { id }, data });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'El código del tipo de comprobante ya existe', 'ACCOUNTING_VOUCHER_TYPE_EXISTS');
    throw error;
  }
}

async function resolveVoucherType(tx, tenantId, { tipoComprobanteId, codigoTipo } = {}) {
  if (tipoComprobanteId) {
    const type = await tx.tipoComprobanteContable.findFirst({ where: { id: tipoComprobanteId, tenantId, activo: true } });
    if (!type) throw new AppError(400, 'Tipo de comprobante inválido', 'ACCOUNTING_VOUCHER_TYPE_INVALID');
    return type;
  }
  const code = normalizeCode(codigoTipo || 'AU');
  const type = await tx.tipoComprobanteContable.findFirst({ where: { tenantId, codigo: code, activo: true } });
  if (!type) throw new AppError(500, `Tipo de comprobante no configurado: ${code}`, 'ACCOUNTING_VOUCHER_TYPE_MISSING');
  return type;
}

async function assignConsecutiveInTx(tx, tenantId, type, date) {
  const d = new Date(date || Date.now());
  const anio = d.getUTCFullYear();
  const mes = type.consecutivoPorPeriodo ? d.getUTCMonth() + 1 : 0;

  const counter = await tx.consecutivoContable.upsert({
    where: {
      tenantId_tipoComprobanteId_anio_mes: {
        tenantId,
        tipoComprobanteId: type.id,
        anio,
        mes
      }
    },
    create: { tenantId, tipoComprobanteId: type.id, anio, mes, ultimoNumero: 1 },
    update: { ultimoNumero: { increment: 1 } }
  });

  const periodPart = type.consecutivoPorPeriodo
    ? `${String(anio)}${String(mes).padStart(2, '0')}`
    : String(anio);
  const numeroComprobante = `${type.codigo}-${periodPart}-${String(counter.ultimoNumero).padStart(6, '0')}`;

  return {
    tipoComprobanteId: type.id,
    numeroConsecutivo: counter.ultimoNumero,
    numeroComprobante
  };
}

module.exports = {
  listVoucherTypes,
  createVoucherType,
  updateVoucherType,
  resolveVoucherType,
  assignConsecutiveInTx
};
