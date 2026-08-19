const assert = require('node:assert/strict');
const { app } = require('../src/app');
const { prisma } = require('../src/config/prisma');

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  async function request(path, options = {}) {
    const response = await fetch(base + path, options);
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }

  async function registerTenant(label) {
    const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const subdomain = `qa-${suffix}`.toLowerCase();
    const email = `${suffix}@qa.local`.toLowerCase();
    const password = 'Integral2026!';
    const register = await request('/api/v1/auth/register-tenant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombreEmpresa: `QA ${label}`,
        nicho: 'ERP',
        subdomain,
        pais: 'CO',
        moneda: 'COP',
        admin: { nombre: `Admin ${label}`, email, password }
      })
    });
    assert.equal(register.status, 201, JSON.stringify(register.body));

    const login = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-subdomain': subdomain },
      body: JSON.stringify({ email, password })
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));

    return {
      subdomain,
      tenantId: register.body.data.tenant.id,
      token: login.body.data.token,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${login.body.data.token}`,
        'x-tenant-subdomain': subdomain
      }
    };
  }

  async function createProduct(ctx, sku, stock = 0, cost = 0, price = 100) {
    const result = await request('/api/v1/inventario/productos', {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({
        tipo: 'PRODUCTO',
        sku,
        nombre: `Producto ${sku}`,
        controlaInventario: true,
        stockActual: stock,
        costoPromedio: cost,
        precio1: price,
        ivaPct: 0,
        impoconsumoPct: 0
      })
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.data;
  }

  try {
    const tenantA = await registerTenant('Integral-A');
    const tenantB = await registerTenant('Integral-B');

    const cashAResponse = await request('/api/v1/tesoreria/cajas-bancos', { headers: tenantA.headers });
    const cashBResponse = await request('/api/v1/tesoreria/cajas-bancos', { headers: tenantB.headers });
    assert.equal(cashAResponse.status, 200);
    assert.equal(cashBResponse.status, 200);
    const cashA = cashAResponse.body.data.find((row) => row.nombre === 'Caja General');
    const cashB = cashBResponse.body.data.find((row) => row.nombre === 'Caja General');
    assert.ok(cashA && cashB);

    const productA = await createProduct(tenantA, `A-${Date.now()}`);
    const productB = await createProduct(tenantB, `B-${Date.now()}`);

    const providerA = await request('/api/v1/terceros', {
      method: 'POST',
      headers: tenantA.headers,
      body: JSON.stringify({
        tipo: 'PROVEEDOR', tipoDocumento: 'NIT', identificacion: `PA-${Date.now()}`,
        nombre: 'Proveedor A', diasPlazo: 30
      })
    });
    assert.equal(providerA.status, 201, JSON.stringify(providerA.body));

    const customerA = await request('/api/v1/terceros', {
      method: 'POST',
      headers: tenantA.headers,
      body: JSON.stringify({
        tipo: 'CLIENTE', tipoDocumento: 'CC', identificacion: `CA-${Date.now()}`,
        nombre: 'Cliente A', cupoCredito: 1000000, diasPlazo: 30
      })
    });
    assert.equal(customerA.status, 201, JSON.stringify(customerA.body));
    const customerAId = customerA.body.data.id;

    const purchaseA = await request('/api/v1/comercial/compras', {
      method: 'POST',
      headers: tenantA.headers,
      body: JSON.stringify({
        estado: 'EMITIDO',
        terceroId: providerA.body.data.id,
        formaPago: 'CREDITO',
        detalles: [{ productoId: productA.id, cantidad: 20, precioUnitario: 50 }]
      })
    });
    assert.equal(purchaseA.status, 201, JSON.stringify(purchaseA.body));

    // 1. Aislamiento por referencias: un tenant no puede usar IDs empresariales de otro.
    const foreignProduct = await request('/api/v1/comercial/ventas', {
      method: 'POST',
      headers: tenantA.headers,
      body: JSON.stringify({
        estado: 'EMITIDO', terceroId: customerAId, formaPago: 'CREDITO',
        detalles: [{ productoId: productB.id, cantidad: 1, precioUnitario: 100 }]
      })
    });
    assert.equal(foreignProduct.status, 400, JSON.stringify(foreignProduct.body));
    assert.equal(foreignProduct.body.error.code, 'COMMERCIAL_PRODUCT_INVALID');

    const tenantBProductCheck = await request(`/api/v1/inventario/productos/${productA.id}`, {
      headers: tenantB.headers
    });
    assert.equal(tenantBProductCheck.status, 404, JSON.stringify(tenantBProductCheck.body));

    // 2. Un fallo por stock insuficiente debe revertir también la creación del documento.
    const failedSource = `NO-STOCK-${Date.now()}`;
    const insufficient = await request('/api/v1/comercial/ventas', {
      method: 'POST',
      headers: tenantA.headers,
      body: JSON.stringify({
        sourceId: failedSource,
        estado: 'EMITIDO', terceroId: customerAId, formaPago: 'CREDITO',
        detalles: [{ productoId: productA.id, cantidad: 999, precioUnitario: 100 }]
      })
    });
    assert.equal(insufficient.status, 409, JSON.stringify(insufficient.body));
    assert.equal(insufficient.body.error.code, 'INVENTORY_INSUFFICIENT_STOCK');
    assert.equal(await prisma.comprobanteComercial.count({ where: { tenantId: tenantA.tenantId, sourceId: failedSource } }), 0);

    // 3. Periodo cerrado: ningún efecto parcial puede sobrevivir al rollback.
    const lockedDate = new Date('2027-01-15T12:00:00.000Z');
    const lockedDraft = await request('/api/v1/comercial/ventas', {
      method: 'POST',
      headers: tenantA.headers,
      body: JSON.stringify({
        estado: 'BORRADOR', terceroId: customerAId, formaPago: 'CREDITO', fecha: lockedDate.toISOString(),
        detalles: [{ productoId: productA.id, cantidad: 2, precioUnitario: 100 }]
      })
    });
    assert.equal(lockedDraft.status, 201, JSON.stringify(lockedDraft.body));

    const stockBeforeLockedIssue = await prisma.producto.findFirst({ where: { id: productA.id, tenantId: tenantA.tenantId } });
    await prisma.periodoContable.upsert({
      where: { tenantId_anio_mes: { tenantId: tenantA.tenantId, anio: 2027, mes: 1 } },
      create: { tenantId: tenantA.tenantId, anio: 2027, mes: 1, estado: 'CERRADO', cerradoEn: new Date() },
      update: { estado: 'CERRADO', cerradoEn: new Date() }
    });

    const lockedIssue = await request(`/api/v1/comercial/ventas/${lockedDraft.body.data.id}/emitir`, {
      method: 'POST', headers: tenantA.headers
    });
    assert.equal(lockedIssue.status, 409, JSON.stringify(lockedIssue.body));
    assert.equal(lockedIssue.body.error.code, 'ACCOUNTING_PERIOD_CLOSED');

    const lockedAfter = await prisma.comprobanteComercial.findFirst({
      where: { id: lockedDraft.body.data.id, tenantId: tenantA.tenantId },
      include: { movimientosInventario: true, cartera: true, asiento: true }
    });
    const stockAfterLockedIssue = await prisma.producto.findFirst({ where: { id: productA.id, tenantId: tenantA.tenantId } });
    assert.equal(lockedAfter.estado, 'BORRADOR');
    assert.equal(lockedAfter.movimientosInventario.length, 0);
    assert.equal(lockedAfter.cartera.length, 0);
    assert.equal(lockedAfter.asiento, null);
    assert.equal(Number(stockAfterLockedIssue.stockActual), Number(stockBeforeLockedIssue.stockActual));

    await prisma.periodoContable.update({
      where: { tenantId_anio_mes: { tenantId: tenantA.tenantId, anio: 2027, mes: 1 } },
      data: { estado: 'ABIERTO', cerradoEn: null }
    });

    // 4. Idempotencia de documentos por sourceId.
    const documentSource = `DOC-IDEM-${Date.now()}`;
    const salePayload = {
      sourceId: documentSource,
      estado: 'EMITIDO', terceroId: customerAId, formaPago: 'CREDITO',
      detalles: [{ productoId: productA.id, cantidad: 2, precioUnitario: 250 }]
    };
    const sale1 = await request('/api/v1/comercial/ventas', {
      method: 'POST', headers: tenantA.headers, body: JSON.stringify(salePayload)
    });
    assert.equal(sale1.status, 201, JSON.stringify(sale1.body));
    const stockAfterSale1 = await prisma.producto.findFirst({ where: { id: productA.id, tenantId: tenantA.tenantId } });

    const sale2 = await request('/api/v1/comercial/ventas', {
      method: 'POST', headers: tenantA.headers, body: JSON.stringify(salePayload)
    });
    assert.equal(sale2.status, 201, JSON.stringify(sale2.body));
    assert.equal(sale2.body.data.id, sale1.body.data.id);
    const stockAfterSale2 = await prisma.producto.findFirst({ where: { id: productA.id, tenantId: tenantA.tenantId } });
    assert.equal(Number(stockAfterSale2.stockActual), Number(stockAfterSale1.stockActual));

    // 5. Pago idempotente + rechazo de sobrepago sin efectos laterales.
    const paymentSource = `PAY-IDEM-${Date.now()}`;
    const paymentPayload = {
      documentoId: sale1.body.data.id,
      monto: 100,
      metodoPago: 'EFECTIVO',
      cajaBancoId: cashA.id,
      sourceId: paymentSource
    };
    const pay1 = await request('/api/v1/pagos', {
      method: 'POST', headers: tenantA.headers, body: JSON.stringify(paymentPayload)
    });
    assert.equal(pay1.status, 201, JSON.stringify(pay1.body));

    const cashAfterPay1 = await prisma.cajaBanco.findFirst({ where: { id: cashA.id, tenantId: tenantA.tenantId } });
    const carteraAfterPay1 = await prisma.cartera.findFirst({ where: { tenantId: tenantA.tenantId, comprobanteId: sale1.body.data.id } });

    const pay2 = await request('/api/v1/pagos', {
      method: 'POST', headers: tenantA.headers, body: JSON.stringify(paymentPayload)
    });
    assert.equal(pay2.status, 201, JSON.stringify(pay2.body));
    assert.equal(pay2.body.data.id, pay1.body.data.id);

    const cashAfterPay2 = await prisma.cajaBanco.findFirst({ where: { id: cashA.id, tenantId: tenantA.tenantId } });
    const carteraAfterPay2 = await prisma.cartera.findFirst({ where: { tenantId: tenantA.tenantId, comprobanteId: sale1.body.data.id } });
    assert.equal(Number(cashAfterPay2.saldoActual), Number(cashAfterPay1.saldoActual));
    assert.equal(Number(carteraAfterPay2.saldo), Number(carteraAfterPay1.saldo));

    const overpay = await request('/api/v1/pagos', {
      method: 'POST',
      headers: tenantA.headers,
      body: JSON.stringify({
        documentoId: sale1.body.data.id,
        monto: 999999,
        metodoPago: 'EFECTIVO',
        cajaBancoId: cashA.id,
        sourceId: `OVERPAY-${Date.now()}`
      })
    });
    assert.equal(overpay.status, 400, JSON.stringify(overpay.body));
    assert.equal(overpay.body.error.code, 'PAYMENT_AMOUNT_INVALID');

    const cashAfterOverpay = await prisma.cajaBanco.findFirst({ where: { id: cashA.id, tenantId: tenantA.tenantId } });
    const carteraAfterOverpay = await prisma.cartera.findFirst({ where: { tenantId: tenantA.tenantId, comprobanteId: sale1.body.data.id } });
    assert.equal(Number(cashAfterOverpay.saldoActual), Number(cashAfterPay2.saldoActual));
    assert.equal(Number(carteraAfterOverpay.saldo), Number(carteraAfterPay2.saldo));

    // 6. Un tenant no puede pagar un documento de otro tenant.
    const foreignPayment = await request('/api/v1/pagos', {
      method: 'POST',
      headers: tenantB.headers,
      body: JSON.stringify({
        documentoId: sale1.body.data.id,
        monto: 10,
        metodoPago: 'EFECTIVO',
        cajaBancoId: cashB.id,
        sourceId: `FOREIGN-${Date.now()}`
      })
    });
    assert.equal(foreignPayment.status, 404, JSON.stringify(foreignPayment.body));
    assert.equal(foreignPayment.body.error.code, 'PAYMENT_DOCUMENT_NOT_FOUND');

    // 7. Anulación repetida es idempotente: no duplica reversos ni altera saldos otra vez.
    const cancel1 = await request(`/api/v1/comercial/ventas/${sale1.body.data.id}/anular`, {
      method: 'POST', headers: tenantA.headers,
      body: JSON.stringify({ motivo: 'QA integral de reverso' })
    });
    assert.equal(cancel1.status, 200, JSON.stringify(cancel1.body));
    const reversalCount1 = await prisma.asientoContable.count({
      where: { tenantId: tenantA.tenantId, reversoDeId: sale1.body.data.asiento.id }
    });
    const stockAfterCancel1 = await prisma.producto.findFirst({ where: { id: productA.id, tenantId: tenantA.tenantId } });
    const cashAfterCancel1 = await prisma.cajaBanco.findFirst({ where: { id: cashA.id, tenantId: tenantA.tenantId } });

    const cancel2 = await request(`/api/v1/comercial/ventas/${sale1.body.data.id}/anular`, {
      method: 'POST', headers: tenantA.headers,
      body: JSON.stringify({ motivo: 'QA integral repetida' })
    });
    assert.equal(cancel2.status, 200, JSON.stringify(cancel2.body));
    assert.equal(cancel2.body.data.yaAnulado, true);

    const reversalCount2 = await prisma.asientoContable.count({
      where: { tenantId: tenantA.tenantId, reversoDeId: sale1.body.data.asiento.id }
    });
    const stockAfterCancel2 = await prisma.producto.findFirst({ where: { id: productA.id, tenantId: tenantA.tenantId } });
    const cashAfterCancel2 = await prisma.cajaBanco.findFirst({ where: { id: cashA.id, tenantId: tenantA.tenantId } });
    assert.equal(reversalCount2, reversalCount1);
    assert.equal(Number(stockAfterCancel2.stockActual), Number(stockAfterCancel1.stockActual));
    assert.equal(Number(cashAfterCancel2.saldoActual), Number(cashAfterCancel1.saldoActual));

    console.log('SUPER CORE INTEGRAL HARDENING OK');
    console.log(JSON.stringify({
      crossTenantReferences: true,
      explicitSaleThirdParty: true,
      atomicRollbackOnInsufficientStock: true,
      atomicRollbackOnClosedPeriod: true,
      documentIdempotency: true,
      paymentIdempotency: true,
      overpaymentRollback: true,
      crossTenantPaymentBlock: true,
      cancellationIdempotency: true
    }, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});