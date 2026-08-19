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

  const jsonHeaders = { 'Content-Type': 'application/json' };
  const tenantA = `qa-a-${Date.now()}`;
  const tenantB = `qa-b-${Date.now()}`;
  const password = 'CoreSmoke2026!';

  try {
    const registerA = await request('/api/v1/auth/register-tenant', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        nit: '900000001-1',
        nombreEmpresa: 'QA Empresa A',
        nicho: 'ERP',
        subdomain: tenantA,
        pais: 'CO',
        moneda: 'COP',
        admin: { nombre: 'Admin QA A', email: `admin-a-${Date.now()}@qa.local`, password }
      })
    });
    assert.equal(registerA.status, 201, JSON.stringify(registerA.body));
    const adminEmailA = registerA.body.data.admin.email;

    const loginA = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-tenant-subdomain': tenantA },
      body: JSON.stringify({ email: adminEmailA, password })
    });
    assert.equal(loginA.status, 200, JSON.stringify(loginA.body));
    const tokenA = loginA.body.data.token;
    assert.ok(tokenA);

    const authA = {
      ...jsonHeaders,
      Authorization: `Bearer ${tokenA}`,
      'x-tenant-subdomain': tenantA
    };

    const sessionA = await request('/api/v1/auth/session', { headers: authA });
    assert.equal(sessionA.status, 200, JSON.stringify(sessionA.body));
    assert.equal(sessionA.body.data.tenant.subdomain, tenantA);

    const accounts = await request('/api/v1/contabilidad/cuentas?limit=1000', { headers: authA });
    assert.equal(accounts.status, 200, JSON.stringify(accounts.body));
    assert.ok(accounts.body.data.length >= 20, 'PUC seed incompleto');
    assert.ok(accounts.body.data.some((account) => account.codigo === '110505'));
    assert.ok(accounts.body.data.some((account) => account.codigo === '413505'));

    const cash = await request('/api/v1/tesoreria/cajas-bancos', { headers: authA });
    assert.equal(cash.status, 200, JSON.stringify(cash.body));
    assert.ok(cash.body.data.some((item) => item.nombre === 'Caja General'));

    const thirdParties = await request('/api/v1/terceros?q=Cuantías', { headers: authA });
    assert.equal(thirdParties.status, 200, JSON.stringify(thirdParties.body));
    assert.ok(thirdParties.body.data.some((item) => item.identificacion === '222222222222'));

    const provider = await request('/api/v1/terceros', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        tipo: 'PROVEEDOR',
        tipoDocumento: 'NIT',
        identificacion: `PRV-${Date.now()}`,
        nombre: 'Proveedor QA',
        cupoCredito: 0,
        diasPlazo: 30
      })
    });
    assert.equal(provider.status, 201, JSON.stringify(provider.body));

    const product = await request('/api/v1/inventario/productos', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        tipo: 'PRODUCTO',
        sku: `SKU-${Date.now()}`,
        nombre: 'Producto QA',
        unidadMedida: 'UND',
        controlaInventario: true,
        costoPromedio: 0,
        stockActual: 0,
        precio1: 200,
        ivaPct: 19,
        impoconsumoPct: 0
      })
    });
    assert.equal(product.status, 201, JSON.stringify(product.body));
    const productId = product.body.data.id;

    const purchase = await request('/api/v1/comercial/comprobantes', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        tipo: 'COMPRA',
        terceroId: provider.body.data.id,
        formaPago: 'CREDITO',
        detalles: [{ productoId: productId, cantidad: 10, precioUnitario: 100 }]
      })
    });
    assert.equal(purchase.status, 201, JSON.stringify(purchase.body));
    assert.equal(purchase.body.data.movimientosInventario.length, 1);
    assert.equal(purchase.body.data.cartera.length, 1);
    assert.ok(purchase.body.data.asiento);
    assert.equal(Number(purchase.body.data.asiento.totalDebito), Number(purchase.body.data.asiento.totalCredito));
    assert.equal(Number(purchase.body.data.total), 1190);

    const afterPurchase = await request(`/api/v1/inventario/productos/${productId}`, { headers: authA });
    assert.equal(afterPurchase.status, 200, JSON.stringify(afterPurchase.body));
    assert.equal(Number(afterPurchase.body.data.stockActual), 10);
    assert.equal(Number(afterPurchase.body.data.costoPromedio), 100);

    const sale = await request('/api/v1/comercial/comprobantes', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        tipo: 'FACTURA_VENTA',
        formaPago: 'CREDITO',
        detalles: [{ productoId: productId, cantidad: 2, precioUnitario: 200 }]
      })
    });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal(sale.body.data.movimientosInventario.length, 1);
    assert.equal(sale.body.data.cartera.length, 1);
    assert.ok(sale.body.data.asiento);
    assert.equal(Number(sale.body.data.asiento.totalDebito), Number(sale.body.data.asiento.totalCredito));
    assert.equal(Number(sale.body.data.total), 476);

    const afterSale = await request(`/api/v1/inventario/productos/${productId}`, { headers: authA });
    assert.equal(afterSale.status, 200, JSON.stringify(afterSale.body));
    assert.equal(Number(afterSale.body.data.stockActual), 8);
    assert.equal(Number(afterSale.body.data.costoPromedio), 100);

    const receivables = await request('/api/v1/tesoreria/cartera?tipo=CXC', { headers: authA });
    assert.equal(receivables.status, 200, JSON.stringify(receivables.body));
    assert.ok(receivables.body.data.some((item) => Number(item.saldo) === 476));

    const payables = await request('/api/v1/tesoreria/cartera?tipo=CXP', { headers: authA });
    assert.equal(payables.status, 200, JSON.stringify(payables.body));
    assert.ok(payables.body.data.some((item) => Number(item.saldo) === 1190));

    const registerB = await request('/api/v1/auth/register-tenant', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        nombreEmpresa: 'QA Empresa B',
        nicho: 'ERP',
        subdomain: tenantB,
        pais: 'CO',
        moneda: 'COP',
        admin: { nombre: 'Admin QA B', email: `admin-b-${Date.now()}@qa.local`, password }
      })
    });
    assert.equal(registerB.status, 201, JSON.stringify(registerB.body));
    const adminEmailB = registerB.body.data.admin.email;

    const crossTenant = await request('/api/v1/auth/session', {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'x-tenant-subdomain': tenantB
      }
    });
    assert.equal(crossTenant.status, 403, JSON.stringify(crossTenant.body));
    assert.equal(crossTenant.body.error.code, 'AUTH_TENANT_MISMATCH');

    const unbalanced = await request('/api/v1/contabilidad/asientos', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        concepto: 'Prueba asiento inválido',
        detalles: [
          { cuentaId: accounts.body.data.find((a) => a.codigo === '110505').id, debito: 100, credito: 0 },
          { cuentaId: accounts.body.data.find((a) => a.codigo === '413505').id, debito: 0, credito: 90 }
        ]
      })
    });
    assert.equal(unbalanced.status, 400, JSON.stringify(unbalanced.body));
    assert.equal(unbalanced.body.error.code, 'ACCOUNTING_UNBALANCED');

    const invalidAmount = await request('/api/v1/contabilidad/asientos', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        concepto: 'Prueba importe inválido',
        detalles: [
          { cuentaId: accounts.body.data.find((a) => a.codigo === '110505').id, debito: 'NO_ES_NUMERO', credito: 0 },
          { cuentaId: accounts.body.data.find((a) => a.codigo === '413505').id, debito: 0, credito: 100 }
        ]
      })
    });
    assert.equal(invalidAmount.status, 400, JSON.stringify(invalidAmount.body));
    assert.equal(invalidAmount.body.error.code, 'ACCOUNTING_AMOUNT_INVALID');

    await prisma.tenant.update({
      where: { subdomain: tenantB },
      data: { activo: false }
    });

    const inactiveTenantLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-tenant-subdomain': tenantB },
      body: JSON.stringify({ email: adminEmailB, password })
    });
    assert.equal(inactiveTenantLogin.status, 403, JSON.stringify(inactiveTenantLogin.body));
    assert.equal(inactiveTenantLogin.body.error.code, 'TENANT_INACTIVE');

    console.log('SUPER CORE SMOKE OK');
    console.log(JSON.stringify({
      tenantSeed: true,
      auth: true,
      tenantIsolation: true,
      inactiveTenantBlock: true,
      thirdParties: true,
      inventoryWeightedAverage: true,
      purchaseAutomation: true,
      saleAutomation: true,
      cartera: true,
      doubleEntry: true,
      invalidAccountingAmountBlock: true
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
