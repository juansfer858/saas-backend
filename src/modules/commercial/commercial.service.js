const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money, qty, pct } = require('../../utils/decimal');
const inventoryService = require('../inventory/inventory.service');
const treasuryService = require('../treasury/treasury.service');
const accountingService = require('../accounting/accounting.service');

const PREFIX = {
  COTIZACION: 'COT',
  FACTURA_VENTA: 'FV',
  COMPRA: 'CP',
  RECIBO_CAJA: 'RC',
  COMPROBANTE_EGRESO: 'CE'
};

function generateNumber(type) {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${PREFIX[type] || 'DOC'}-${Date.now()}-${suffix}`;
}

async function resolveThirdParty(tx, tenantId, type, terceroId) {
  if (terceroId) {
    const tercero = await tx.tercero.findFirst({ where: { id: terceroId, tenantId, activo: true } });
    if (!tercero) throw new AppError(400, 'Tercero inválido para esta empresa', 'COMMERCIAL_THIRD_PARTY_INVALID');
    return tercero;
  }

  if (type === 'FACTURA_VENTA') {
    const generic = await tx.tercero.findFirst({
      where: { tenantId, identificacion: '222222222222', activo: true }
    });
    if (!generic) throw new AppError(500, 'Cliente genérico no configurado', 'GENERIC_CUSTOMER_MISSING');
    return generic;
  }

  if (type === 'COMPRA') {
    throw new AppError(400, 'Una compra requiere proveedor', 'PURCHASE_SUPPLIER_REQUIRED');
  }

  return null;
}

async function buildLines(tx, tenantId, type, inputDetails) {
  const productIds = [...new Set(inputDetails.map((line) => line.productoId).filter(Boolean))];
  const products = productIds.length
    ? await tx.producto.findMany({ where: { tenantId, id: { in: productIds }, activo: true } })
    : [];
  const byId = new Map(products.map((product) => [product.id, product]));

  if (products.length !== productIds.length) {
    throw new AppError(400, 'Uno o más productos no pertenecen al tenant', 'COMMERCIAL_PRODUCT_INVALID');
  }

  return inputDetails.map((input) => {
    const product = input.productoId ? byId.get(input.productoId) : null;
    const quantity = qty(input.cantidad);
    const price = money(input.precioUnitario);
    const discountPct = pct(input.descuentoPct || 0);
    const ivaPct = pct(input.ivaPct ?? product?.ivaPct ?? 0);
    const impoconsumoPct = pct(input.impoconsumoPct ?? product?.impoconsumoPct ?? 0);

    const gross = money(quantity.mul(price));
    const discount = money(gross.mul(discountPct).div(100));
    const subtotal = money(gross.minus(discount));
    const iva = money(subtotal.mul(ivaPct).div(100));
    const impoconsumo = money(subtotal.mul(impoconsumoPct).div(100));
    const total = money(subtotal.plus(iva).plus(impoconsumo));
    const purchaseNetUnit = quantity.gt(0) ? decimal(subtotal).div(quantity).toDecimalPlaces(4) : decimal(0);
    const snapshotCost = product
      ? (type === 'COMPRA' ? purchaseNetUnit : decimal(product.costoPromedio).toDecimalPlaces(4))
      : decimal(0);

    return {
      product,
      productoId: product?.id || null,
      descripcion: input.descripcion || product?.nombre || 'Concepto comercial',
      cantidad: quantity,
      precioUnitario: price,
      descuentoPct,
      ivaPct,
      impoconsumoPct,
      gross,
      descuento: discount,
      subtotal,
      iva,
      impoconsumo,
      total,
      costoUnitario: snapshotCost,
      purchaseNetUnit
    };
  });
}

function sumLines(lines, field) {
  return money(lines.reduce((acc, line) => acc.plus(line[field]), decimal(0)));
}

async function settlementAccount(tx, tenantId, type, formaPago, cajaBancoId) {
  if (formaPago === 'CREDITO') {
    return accountingService.getMappedAccount(tx, tenantId, type === 'FACTURA_VENTA' ? 'CLIENTES' : 'PROVEEDORES');
  }

  if (!cajaBancoId) throw new AppError(400, 'Pago contado requiere Caja/Banco', 'PAYMENT_ACCOUNT_REQUIRED');
  const caja = await treasuryService.getCajaBanco(tenantId, cajaBancoId, tx);

  if (caja.cuentaContableId) {
    const account = await tx.cuentaPUC.findFirst({
      where: { id: caja.cuentaContableId, tenantId, activa: true, permiteMovimiento: true }
    });
    if (account) return account;
  }

  return accountingService.getMappedAccount(tx, tenantId, caja.tipo === 'BANCO' ? 'BANCO_GENERAL' : 'CAJA_GENERAL');
}

function addLine(lines, cuentaId, debito, credito, terceroId, concepto) {
  const d = money(debito || 0);
  const c = money(credito || 0);
  if (d.eq(0) && c.eq(0)) return;
  lines.push({ cuentaId, terceroId: terceroId || null, concepto, debito: d, credito: c });
}

async function createAccountingForDocument(tx, params) {
  const {
    tenantId,
    userId,
    comprobante,
    tercero,
    formaPago,
    cajaBancoId,
    subtotal,
    ivaTotal,
    impoconsumoTotal,
    inventoryBase,
    expenseBase,
    costOfSales
  } = params;

  const lines = [];
  const settlement = await settlementAccount(tx, tenantId, comprobante.tipo, formaPago, cajaBancoId);

  if (comprobante.tipo === 'FACTURA_VENTA') {
    const sales = await accountingService.getMappedAccount(tx, tenantId, 'VENTAS');
    const vat = ivaTotal.gt(0) ? await accountingService.getMappedAccount(tx, tenantId, 'IMPUESTO_VENTA') : null;
    const consumption = impoconsumoTotal.gt(0)
      ? await accountingService.getMappedAccount(tx, tenantId, 'IMPOCONSUMO_VENTA')
      : null;

    addLine(lines, settlement.id, comprobante.total, 0, tercero?.id, `Cobro/cliente ${comprobante.numero}`);
    addLine(lines, sales.id, 0, subtotal, tercero?.id, `Venta ${comprobante.numero}`);
    if (vat) addLine(lines, vat.id, 0, ivaTotal, tercero?.id, `IVA ${comprobante.numero}`);
    if (consumption) addLine(lines, consumption.id, 0, impoconsumoTotal, tercero?.id, `Impoconsumo ${comprobante.numero}`);

    if (costOfSales.gt(0)) {
      const cogs = await accountingService.getMappedAccount(tx, tenantId, 'COSTO_VENTAS');
      const inventory = await accountingService.getMappedAccount(tx, tenantId, 'INVENTARIO');
      addLine(lines, cogs.id, costOfSales, 0, tercero?.id, `Costo venta ${comprobante.numero}`);
      addLine(lines, inventory.id, 0, costOfSales, tercero?.id, `Salida inventario ${comprobante.numero}`);
    }
  } else if (comprobante.tipo === 'COMPRA') {
    if (inventoryBase.gt(0)) {
      const inventory = await accountingService.getMappedAccount(tx, tenantId, 'INVENTARIO');
      addLine(lines, inventory.id, inventoryBase, 0, tercero?.id, `Compra inventario ${comprobante.numero}`);
    }

    if (expenseBase.gt(0)) {
      const expense = await accountingService.getMappedAccount(tx, tenantId, 'GASTO_COMPRA');
      addLine(lines, expense.id, expenseBase, 0, tercero?.id, `Compra/gasto ${comprobante.numero}`);
    }

    if (ivaTotal.gt(0)) {
      const vat = await accountingService.getMappedAccount(tx, tenantId, 'IMPUESTO_COMPRA');
      addLine(lines, vat.id, ivaTotal, 0, tercero?.id, `IVA compra ${comprobante.numero}`);
    }

    if (impoconsumoTotal.gt(0)) {
      const consumption = await accountingService.getMappedAccount(tx, tenantId, 'IMPOCONSUMO_COMPRA');
      addLine(lines, consumption.id, impoconsumoTotal, 0, tercero?.id, `Impoconsumo compra ${comprobante.numero}`);
    }

    addLine(lines, settlement.id, 0, comprobante.total, tercero?.id, `Pago/proveedor ${comprobante.numero}`);
  }

  return accountingService.createJournalInTx(tx, {
    tenantId,
    userId,
    comprobanteId: comprobante.id,
    fecha: comprobante.fecha,
    concepto: `${comprobante.tipo} ${comprobante.numero}`,
    referencia: comprobante.numero,
    detalles: lines
  });
}

async function createDocument(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    const tercero = await resolveThirdParty(tx, tenantId, input.tipo, input.terceroId);
    const lines = await buildLines(tx, tenantId, input.tipo, input.detalles);

    const subtotal = sumLines(lines, 'subtotal');
    const descuentoTotal = sumLines(lines, 'descuento');
    const ivaTotal = sumLines(lines, 'iva');
    const impoconsumoTotal = sumLines(lines, 'impoconsumo');
    const total = sumLines(lines, 'total');

    if (['FACTURA_VENTA', 'COMPRA'].includes(input.tipo) && !input.formaPago) {
      throw new AppError(400, 'Factura/Compra requiere forma de pago', 'PAYMENT_METHOD_REQUIRED');
    }

    const numero = input.numero || generateNumber(input.tipo);
    const isCredit = input.formaPago === 'CREDITO';

    const comprobante = await tx.comprobanteComercial.create({
      data: {
        tenantId,
        tipo: input.tipo,
        numero,
        estado: input.tipo === 'COTIZACION' ? 'BORRADOR' : 'CONFIRMADO',
        terceroId: tercero?.id || null,
        cajaBancoId: input.cajaBancoId || null,
        creadoPorId: userId,
        formaPago: input.formaPago || null,
        fecha: input.fecha || new Date(),
        fechaVencimiento: input.fechaVencimiento || null,
        observaciones: input.observaciones || null,
        subtotal,
        descuentoTotal,
        ivaTotal,
        impoconsumoTotal,
        total,
        saldo: isCredit ? total : 0
      }
    });

    await tx.detalleComprobante.createMany({
      data: lines.map((line) => ({
        tenantId,
        comprobanteId: comprobante.id,
        productoId: line.productoId,
        descripcion: line.descripcion,
        cantidad: line.cantidad,
        precioUnitario: line.precioUnitario,
        descuentoPct: line.descuentoPct,
        ivaPct: line.ivaPct,
        impoconsumoPct: line.impoconsumoPct,
        subtotalLinea: line.subtotal,
        ivaValor: line.iva,
        impoconsumoValor: line.impoconsumo,
        totalLinea: line.total,
        costoUnitario: line.costoUnitario
      }))
    });

    if (!['FACTURA_VENTA', 'COMPRA'].includes(input.tipo)) {
      return tx.comprobanteComercial.findUnique({
        where: { id: comprobante.id },
        include: { detalles: true, tercero: true }
      });
    }

    let costOfSales = money(0);
    let inventoryBase = money(0);
    let expenseBase = money(0);

    for (const line of lines) {
      if (line.product && line.product.tipo === 'PRODUCTO' && line.product.controlaInventario) {
        const movementResult = await inventoryService.applyMovement(tx, {
          tenantId,
          productoId: line.product.id,
          comprobanteId: comprobante.id,
          tipo: input.tipo === 'FACTURA_VENTA' ? 'VENTA' : 'COMPRA',
          cantidad: line.cantidad,
          costoUnitario: input.tipo === 'COMPRA' ? line.purchaseNetUnit : undefined,
          referencia: comprobante.numero
        });

        if (input.tipo === 'FACTURA_VENTA') {
          costOfSales = money(costOfSales.plus(movementResult.costOfMovement));
        } else {
          inventoryBase = money(inventoryBase.plus(line.subtotal));
        }
      } else if (input.tipo === 'COMPRA') {
        expenseBase = money(expenseBase.plus(line.subtotal));
      }
    }

    await treasuryService.applyCommercialSettlement(tx, {
      tenantId,
      userId,
      comprobante,
      terceroId: tercero?.id || null,
      formaPago: input.formaPago,
      cajaBancoId: input.cajaBancoId || null
    });

    await createAccountingForDocument(tx, {
      tenantId,
      userId,
      comprobante,
      tercero,
      formaPago: input.formaPago,
      cajaBancoId: input.cajaBancoId || null,
      subtotal,
      ivaTotal,
      impoconsumoTotal,
      inventoryBase,
      expenseBase,
      costOfSales
    });

    return tx.comprobanteComercial.findUnique({
      where: { id: comprobante.id },
      include: {
        detalles: true,
        tercero: true,
        cartera: true,
        movimientosInventario: true,
        asiento: { include: { detalles: true } }
      }
    });
  });
}

async function listDocuments(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.tipo) where.tipo = filters.tipo;
  if (filters.estado) where.estado = filters.estado;
  if (filters.terceroId) where.terceroId = filters.terceroId;

  return prisma.comprobanteComercial.findMany({
    where,
    include: { tercero: true },
    orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
    take: Math.min(Number(filters.limit) || 100, 500)
  });
}

async function getDocument(tenantId, id) {
  const document = await prisma.comprobanteComercial.findFirst({
    where: { id, tenantId },
    include: {
      tercero: true,
      cajaBanco: true,
      detalles: { include: { producto: true } },
      movimientosInventario: true,
      cartera: true,
      asiento: {
        include: { detalles: { include: { cuenta: true, tercero: true } } }
      }
    }
  });

  if (!document) throw new AppError(404, 'Comprobante no encontrado', 'COMMERCIAL_DOCUMENT_NOT_FOUND');
  return document;
}

module.exports = { createDocument, listDocuments, getDocument };
