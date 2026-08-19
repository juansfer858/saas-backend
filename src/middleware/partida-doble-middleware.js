const { AppError } = require('../utils/app-error');
const { decimal, money } = require('../utils/decimal');

function validateJournalLines(detalles) {
  if (!Array.isArray(detalles) || detalles.length < 2) {
    throw new AppError(400, 'Un asiento requiere al menos dos líneas', 'ACCOUNTING_LINES_REQUIRED');
  }

  let totalDebito = decimal(0);
  let totalCredito = decimal(0);

  for (const [index, line] of detalles.entries()) {
    const debito = money(line.debito || 0);
    const credito = money(line.credito || 0);

    if (debito.lt(0) || credito.lt(0)) {
      throw new AppError(400, `Débito/crédito inválido en línea ${index + 1}`, 'ACCOUNTING_NEGATIVE_VALUE');
    }

    if ((debito.gt(0) && credito.gt(0)) || (debito.eq(0) && credito.eq(0))) {
      throw new AppError(
        400,
        `Cada línea debe tener únicamente débito o crédito en línea ${index + 1}`,
        'ACCOUNTING_LINE_SIDE_INVALID'
      );
    }

    totalDebito = totalDebito.plus(debito);
    totalCredito = totalCredito.plus(credito);
  }

  if (!money(totalDebito).eq(money(totalCredito)) || money(totalDebito).eq(0)) {
    throw new AppError(400, 'El asiento no cumple partida doble', 'ACCOUNTING_UNBALANCED', {
      totalDebito: money(totalDebito).toString(),
      totalCredito: money(totalCredito).toString()
    });
  }

  return {
    totalDebito: money(totalDebito),
    totalCredito: money(totalCredito)
  };
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
