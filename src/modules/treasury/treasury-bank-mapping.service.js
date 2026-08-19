const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { auditInTx } = require('../accounting/accounting-audit.service');

async function setAccountingAccount(tenantId, userId, cajaBancoId, cuentaContableId) {
  return prisma.$transaction(async (tx) => {
    const [cashBank, account] = await Promise.all([
      tx.cajaBanco.findFirst({ where: { id: cajaBancoId, tenantId, activo: true } }),
      tx.cuentaPUC.findFirst({ where: { id: cuentaContableId, tenantId, activa: true, permiteMovimiento: true } })
    ]);
    if (!cashBank) throw new AppError(404, 'Caja/Banco no encontrado', 'TREASURY_ACCOUNT_NOT_FOUND');
    if (!account) throw new AppError(400, 'Cuenta PUC inválida para Caja/Banco', 'TREASURY_ACCOUNTING_ACCOUNT_INVALID');
    const updated = await tx.cajaBanco.update({
      where: { id: cashBank.id },
      data: { cuentaContableId: account.id },
      include: { cuentaContable: { select: { id: true, codigo: true, nombre: true, naturaleza: true } } }
    });
    if (userId) {
      await auditInTx(tx, {
        tenantId,
        userId,
        entidad: 'CAJA_BANCO',
        entidadId: cashBank.id,
        accion: 'MAPEAR_CUENTA_CONTABLE',
        metadata: { cuentaId: account.id, codigo: account.codigo }
      });
    }
    return updated;
  });
}

module.exports = { setAccountingAccount };
