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

  const suffix = Date.now();
  const subdomain = `lifecycle-${suffix}`;
  const password = 'Lifecycle2026!';
  const jsonHeaders = { 'Content-Type': 'application/json' };

  try {
    const register = await request('/api/v1/auth/register-tenant', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        nombreEmpresa: 'QA Lifecycle',
        nicho: 'ERP',
        subdomain,
        pais: 'CO',
        moneda: 'COP',
        admin: { nombre: 'Admin Lifecycle', email: `lifecycle-${suffix}@qa.local`, password }
      })
    });
    assert.equal(register.status, 201, JSON.stringify(register.body));

    const login = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-tenant-subdomain': subdomain },
      body: JSON.stringify({ email: register.body.data.admin.email, password })
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));

    const auth = {
      ...jsonHeaders,
      Authorization: `Bearer ${login.body.data.token}`,
      'x-tenant-subdomain': subdomain
    };

    const cashList = await request('/api/v1/tesoreria/cajas-bancos', { headers: auth });
    assert.equal(cashList.status, 200, JSON.stringify(cashList.body));
    const cash = cashList.body.data.find((row) => row.nombre === 'Caja General');
    assert.ok(cash);

    const provider = await request('/api/v1/terceros', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        tipo: 'PROVEEDOR', tipoDocumento: 'NIT', identificacion: `PRV-${suffix}`,
        nombre: 'Proveedor Lifecycle', diasPlazo: 30
      })
    });
    assert.equal(provider.status, 201, JSON.stringify(provider.body));

    const product = await request('/api/v1/inventario/productos', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        tipo: 'PRODUCTO', sku: `LC-${suffix}`, nombre: 'Producto Lifecycle',
        controlaInventario: true, stockActual: 0, costoPromedio: 0,
        precio1: 300, ivaPct: 0, impoconsumoPct: 0
      })
    });
    assert.equal(product.status, 201, JSON.stringify(product.body));
    const productId = product.body.data.id;

    const purchase = await request('/api/v1/comercial/compras', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        estado: 'EMITIDO', terceroId: provider.body.data.id, formaPago: 'CREDITO',
        detalles: [{ productoId, cantidad: 20, precioUnitario: 100 }]
      })
    });
    assert.equal(purchase.status, 201, JSON.stringify(purchase.body));
    assert.equal(purchase.body.data.estado, 'EMITIDO');

    let stock = await request(`/api/v1/inventario/productos/${productId}`, { headers: auth });
    assert.equal(Number(stock.body.data.stockActual), 20);

    const draft = await request('/api/v1/comercial/ventas', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        estado: 'BORRADOR', formaPago: 'CREDITO',
        detalles: [{ productoId, cantidad: 4, precioUnitario: 200 }]
      })
    });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    assert.equal(draft.body.data.estado, 'BORRADOR');
    assert.equal(draft.body.data.movimientosInventario.length, 0);
    assert.equal(draft.body.data.asiento, null);

    stock = await request(`/api/v1/inventario/productos/${productId}`, { headers: auth });
    assert.equal(Number(stock.body.data.stockActual), 20);

    const edited = await request(`/api/v1/comercial/ventas/${draft.body.data.id}`, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ detalles: [{ productoId, cantidad: 4, precioUnitario: 250 }] })
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(Number(edited.body.data.total), 1000);

    const emitted = await request(`/api/v1/comercial/ventas/${draft.body.data.id}/emitir`, {
      method: 'POST', headers: auth
    });
    assert.equal(emitted.status, 200, JSON.stringify(emitted.body));
    assert.equal(emitted.body.data.estado, 'EMITIDO');
    assert.equal(Number(emitted.body.data.saldo), 1000);
    assert.ok(emitted.body.data.asiento);

    stock = await request(`/api/v1/inventario/productos/${productId}`, { headers: auth });
    assert.equal(Number(stock.body.data.stockActual), 16);

    const immutable = await request(`/api/v1/comercial/ventas/${draft.body.data.id}`, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ observaciones: 'Intento de edición directa' })
    });
    assert.equal(immutable.status, 409, JSON.stringify(immutable.body));
    assert.equal(immutable.body.error.code, 'COMMERCIAL_IMMUTABLE_USE_REPLACE');

    const payment1 = await request('/api/v1/pagos', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        documentoId: draft.body.data.id, monto: 400, metodoPago: 'EFECTIVO',
        cajaBancoId: cash.id, sourceId: `PAY-1-${suffix}`
      })
    });
    assert.equal(payment1.status, 201, JSON.stringify(payment1.body));
    assert.equal(Number(payment1.body.data.cartera.saldo), 600);
    assert.equal(payment1.body.data.documento.estado, 'PAGADO_PARCIAL');

    const payment2 = await request('/api/v1/pagos', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        documentoId: draft.body.data.id, monto: 600, metodoPago: 'EFECTIVO',
        cajaBancoId: cash.id, sourceId: `PAY-2-${suffix}`
      })
    });
    assert.equal(payment2.status, 201, JSON.stringify(payment2.body));
    assert.equal(Number(payment2.body.data.cartera.saldo), 0);
    assert.equal(payment2.body.data.documento.estado, 'PAGADO_TOTAL');

    let cashAfter = await request('/api/v1/tesoreria/cajas-bancos', { headers: auth });
    assert.equal(Number(cashAfter.body.data.find((row) => row.id === cash.id).saldoActual), 1000);

    const cancelledPaid = await request(`/api/v1/comercial/ventas/${draft.body.data.id}/anular`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ motivo: 'Anulación integral de QA' })
    });
    assert.equal(cancelledPaid.status, 200, JSON.stringify(cancelledPaid.body));
    assert.equal(cancelledPaid.body.data.documento.estado, 'ANULADO');
    assert.equal(cancelledPaid.body.data.ajuste.tipo, 'NOTA_CREDITO');
    assert.ok(cancelledPaid.body.data.ajuste.asiento);

    stock = await request(`/api/v1/inventario/productos/${productId}`, { headers: auth });
    assert.equal(Number(stock.body.data.stockActual), 20);
    cashAfter = await request('/api/v1/tesoreria/cajas-bancos', { headers: auth });
    assert.equal(Number(cashAfter.body.data.find((row) => row.id === cash.id).saldoActual), 0);

    const cashSale = await request('/api/v1/comercial/ventas', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        estado: 'EMITIDO', formaPago: 'EFECTIVO', cajaBancoId: cash.id,
        detalles: [{ productoId, cantidad: 2, precioUnitario: 300 }]
      })
    });
    assert.equal(cashSale.status, 201, JSON.stringify(cashSale.body));
    cashAfter = await request('/api/v1/tesoreria/cajas-bancos', { headers: auth });
    assert.equal(Number(cashAfter.body.data.find((row) => row.id === cash.id).saldoActual), 600);

    const cancelCashSale = await request(`/api/v1/comercial/ventas/${cashSale.body.data.id}/anular`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ motivo: 'Reverso venta contado QA' })
    });
    assert.equal(cancelCashSale.status, 200, JSON.stringify(cancelCashSale.body));
    cashAfter = await request('/api/v1/tesoreria/cajas-bancos', { headers: auth });
    assert.equal(Number(cashAfter.body.data.find((row) => row.id === cash.id).saldoActual), 0);

    const saleForReplace = await request('/api/v1/comercial/ventas', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        estado: 'EMITIDO', formaPago: 'CREDITO',
        detalles: [{ productoId, cantidad: 1, precioUnitario: 200 }]
      })
    });
    assert.equal(saleForReplace.status, 201, JSON.stringify(saleForReplace.body));

    const replacement = await request(`/api/v1/comercial/ventas/${saleForReplace.body.data.id}/reemplazar`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        motivo: 'Corrección de precio QA',
        detalles: [{ productoId, cantidad: 1, precioUnitario: 300 }]
      })
    });
    assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
    assert.equal(replacement.body.data.anulacion.documento.estado, 'ANULADO');
    assert.equal(replacement.body.data.nuevo.estado, 'EMITIDO');
    assert.equal(Number(replacement.body.data.nuevo.total), 300);

    const filtered = await request('/api/v1/comercial/ventas?estado=EMITIDO&montoMin=250&page=1&pageSize=10', { headers: auth });
    assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
    assert.ok(Array.isArray(filtered.body.data));
    assert.ok(filtered.body.meta);
    assert.equal(filtered.body.meta.page, 1);

    console.log('STEP 4 LIFECYCLE SMOKE OK');
    console.log(JSON.stringify({
      draftNoEffects: true,
      issueAtomicEffects: true,
      immutableIssuedDocument: true,
      partialAndFullPayments: true,
      paymentAccounting: true,
      paidCancellationReversal: true,
      cashCancellationReversal: true,
      replacementWithReentry: true,
      filtersAndPagination: true
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
