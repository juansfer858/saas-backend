const { AppError } = require('../utils/app-error');

const MAPPING_LABELS = {
  CAJA_GENERAL: 'Caja general',
  BANCO_GENERAL: 'Bancos',
  CLIENTES: 'Clientes / cuentas por cobrar',
  PROVEEDORES: 'Proveedores / cuentas por pagar',
  INVENTARIO: 'Inventario de mercancías',
  COSTO_VENTAS: 'Costo de ventas',
  VENTAS: 'Ingresos por ventas',
  IMPUESTO_VENTA: 'IVA generado',
  IMPUESTO_COMPRA: 'IVA descontable',
  GASTO_COMPRA: 'Gasto de compra',
  GASTO_FALTANTE_INVENTARIO: 'Gasto por faltante/merma de inventario',
  INGRESO_SOBRANTE_INVENTARIO: 'Ingreso por sobrante de inventario',
  GASTO_DIRECTO: 'Gasto directo de tesorería'
};

function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) {
    if (error.code === 'ACCOUNTING_MAPPING_MISSING') {
      const key = error.details?.clave || String(error.message || '').split(':').pop()?.trim();
      const label = MAPPING_LABELS[key] || key || 'requerida';
      return res.status(409).json({
        ok: false,
        error: {
          code: 'ACCOUNTING_CONFIGURATION_REQUIRED',
          message: `Configure la cuenta contable de ${label} antes de continuar`,
          details: { ...(error.details || {}), clave: key, label }
        }
      });
    }
    return res.status(error.statusCode).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
  }

  console.error('UNHANDLED_ERROR:', error);

  return res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor'
    }
  });
}

module.exports = { errorHandler };
