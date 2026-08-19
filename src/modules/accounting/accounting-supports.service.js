const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { auditInTx } = require('./accounting-audit.service');

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

async function addSupport(tenantId, userId, journalId, input) {
  const journal = await prisma.asientoContable.findFirst({ where: { id: journalId, tenantId } });
  if (!journal) throw new AppError(404, 'Asiento no encontrado', 'ACCOUNTING_JOURNAL_NOT_FOUND');
  if (!ALLOWED.has(input.mimeType)) throw new AppError(400, 'Tipo de archivo no permitido', 'ACCOUNTING_SUPPORT_MIME_INVALID');
  let buffer;
  try { buffer = Buffer.from(input.base64, 'base64'); } catch (_error) { throw new AppError(400, 'Archivo inválido', 'ACCOUNTING_SUPPORT_INVALID'); }
  if (!buffer.length || buffer.length > MAX_BYTES) throw new AppError(400, 'El soporte debe pesar entre 1 byte y 5 MB', 'ACCOUNTING_SUPPORT_SIZE_INVALID');
  const hashSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return prisma.$transaction(async (tx) => {
    const support = await tx.soporteAsiento.create({
      data: {
        tenantId,
        asientoId: journalId,
        subidoPorId: userId,
        nombre: input.nombre,
        mimeType: input.mimeType,
        tamano: buffer.length,
        hashSha256,
        contenido: buffer
      },
      select: { id: true, asientoId: true, nombre: true, mimeType: true, tamano: true, hashSha256: true, creadoEn: true }
    });
    await auditInTx(tx, { tenantId, userId, entidad: 'ASIENTO', entidadId: journalId, accion: 'ADJUNTAR_SOPORTE', metadata: { soporteId: support.id, nombre: support.nombre, hashSha256 } });
    return support;
  });
}

async function getSupport(tenantId, id) {
  const support = await prisma.soporteAsiento.findFirst({ where: { id, tenantId } });
  if (!support) throw new AppError(404, 'Soporte no encontrado', 'ACCOUNTING_SUPPORT_NOT_FOUND');
  return support;
}

module.exports = { addSupport, getSupport, MAX_BYTES, ALLOWED };
