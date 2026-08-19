const { AppError } = require('../utils/app-error');
const { decimal, money } = require('../utils/decimal');

function parseMoney(value, field, lineNumber) {
  try {
    return money(value ?? 0);
  } catch (_error) {
    throw new AppError(
      400,
      `${field} inválido en línea ${lineNumber}`,
      'ACCOUNTING_AMOUNT_INVALID'
    );
  }
}

/**
 * Valida la regla central de partida doble antes de persistir un asiento.
 * Cada línea debe afectar un solo lado y la suma de débitos debe coincidir
 * exactamente con la suma de créditos después de normalizar a 2 decimales.
 */
function validateJournalLines(detalles) {
  if (!Array.isArray(detalles) || detalles.length < 2) {
    throw new AppError(400, 'Un asiento requiere al menos dos líneas', 'ACCOUNTING_LINES_REQUIRED');
  }

  let totalDebito = decimal(0);
  let totalCredito = decimal(0);

  for (const [index, line] of detalles.entries()) {
    const lineNumber = index + 1;

    if (!line || typeof line !== 'object' || !line.cuentaId) {
      throw new AppError(
        400,
        `La cuenta contable es obligatoria en línea ${lineNumber}`,
        'ACCOUNTING_ACCOUNT_REQUIRED'
      );
    }

    const debito = parseMoney(line.debito, 'Débito', lineNumber);
    const credito = parseMoney(line.credito, 'Crédito', lineNumber);

    if (debito.lt(0) || credito.lt(0)) {
      throw new AppError(400, `Débito/crédito inválido en línea ${lineNumber}`, 'ACCOUNTING_NEGATIVE_VALUE');
    }

    if ((debito.gt(0) && credito.gt(0)) || (debito.eq(0) && credito.eq(0))) {
      throw new AppError(
        400,
        `Cada línea debe tener únicamente débito o crédito en línea ${lineNumber}`,
        'ACCOUNTING_LINE_SIDE_INVALID'
      );
    }

    totalDebito = totalDebito.plus(debito);
    totalCredito = totalCredito.plus(credito);
  }

  totalDebito = money(totalDebito);
  totalCredito = money(totalCredito);

  if (!totalDebito.eq(totalCredito) || totalDebito.eq(0)) {
    throw new AppError(400, 'El asiento no cumple partida doble', 'ACCOUNTING_UNBALANCED', {
      totalDebito: totalDebito.toString(),
      totalCredito: totalCredito.toString()
    });
  }

  return { totalDebito, totalCredito };
}

function partidaDobleMiddleware(req, _res, next) {
  try {
    req.partidaDoble = validateJournalLines(req.body?.detalles);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  partidaDobleMiddleware,
  validateJournalLines
};
