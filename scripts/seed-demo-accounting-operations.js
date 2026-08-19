const { prisma } = require('../src/config/prisma');
const commercialService = require('../src/modules/commercial/commercial.service');
const treasuryService = require('../src/modules/treasury/treasury.service');

const IDS = {
  purchase: 'DEMO-ACC-PURCHASE-001',
  sale: 'DEMO-ACC-SALE-001',
  payment: 'DEMO-ACC-PAYMENT-001'
};

async function seedDemoAccountingOperations() {
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'demo-core' } });
  if (!tenant) throw new Error('Tenant demo-core no existe');

  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: 'admin@demo-core.vantixgc.com', activo: true }
  });
  if (!admin) throw new Error('Administrador demo-core no existe');

  const caja = await prisma.cajaBanco.findUnique({
    where: { tenantId_nombre: { tenantId: tenant.id, nombre: 'Caja General' } }
  });
  if (!caja) throw new Error('Caja General no existe');

  const proveedor = await prisma.tercero.upsert({
    where: {
      tenantId_identificacion: {
        tenantId: tenant.id,
        identificacion: '900999001'
      }
    },
    create: {
      tenantId: tenant.id,
      tipo: 'PROVEEDOR',
      tipoDocumento: 'NIT',
      identificacion: '900999001',
      nombre: 'Proveedor Demo VantixGC',
      razonSocial: 'Proveedor Demo VantixGC S.A.S.',
      email: 'proveedor.demo@vantixgc.local',
      activo: true
    },
    update: {
      tipo: 'PROVEEDOR',
      nombre: 'Proveedor Demo VantixGC',
      razonSocial: 'Proveedor Demo VantixGC S.A.S.',
      activo: true
    }
  });

  const producto = await prisma.producto.upsert({
    where: {
      tenantId_sku: {
        tenantId: tenant.id,
        sku: 'DEMO-CONT-001'
      }
    },
    create: {
      tenantId: tenant.id,
      tipo: 'PRODUCTO',
      sku: 'DEMO-CONT-001',
      nombre: 'Producto Demo Contabilidad',
      descripcion: 'Producto permanente para probar Kardex y contabilidad',
      unidadMedida: 'UND',
      controlaInventario: true,
      costoPromedio: 0,
      stockActual: 0,
      precio1: 35000,
      ivaPct: 19,
      activo: true
    },
    update: {
      nombre: 'Producto Demo Contabilidad',
      controlaInventario: true,
      precio1: 35000,
      ivaPct: 19,
      activo: true
    }
  });

  const purchase = await commercialService.createDocument(tenant.id, admin.id, {
    tipo: 'COMPRA',
    sourceId: IDS.purchase,
    estado: 'EMITIDO',
    terceroId: proveedor.id,
    formaPago: 'CREDITO',
    observaciones: 'Compra real de prueba para Libro Diario / Kardex',
    detalles: [
      {
        productoId: producto.id,
        cantidad: 10,
        precioUnitario: 20000,
        descuentoPct: 0,
        ivaPct: 19,
        impoconsumoPct: 0
      }
    ]
  });

  const sale = await commercialService.createDocument(tenant.id, admin.id, {
    tipo: 'FACTURA_VENTA',
    sourceId: IDS.sale,
    estado: 'EMITIDO',
    formaPago: 'CREDITO',
    observaciones: 'Venta real de prueba para Libro Diario / Kardex / Cartera',
    detalles: [
      {
        productoId: producto.id,
        cantidad: 2,
        precioUnitario: 35000,
        descuentoPct: 0,
        ivaPct: 19,
        impoconsumoPct: 0
      }
    ]
  });

  const payment = await treasuryService.registerPayment(tenant.id, admin.id, {
    documentoId: sale.id,
    monto: 30000,
    metodoPago: 'EFECTIVO',
    cajaBancoId: caja.id,
    sourceId: IDS.payment,
    referencia: 'Abono demo con Recibo de Caja'
  });

  const [productState, cashState, journals] = await Promise.all([
    prisma.producto.findUnique({ where: { id: producto.id } }),
    prisma.cajaBanco.findUnique({ where: { id: caja.id } }),
    prisma.asientoContable.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { sourceId: `ACC-${IDS.purchase}` },
          { sourceId: `ACC-${IDS.sale}` },
          { sourceId: `PAY-${IDS.payment}` }
        ]
      },
      include: { detalles: true },
      orderBy: { fecha: 'asc' }
    })
  ]);

  return {
    tenantId: tenant.id,
    purchase: { id: purchase.id, numero: purchase.numero, total: purchase.total },
    sale: { id: sale.id, numero: sale.numero, total: sale.total, estado: sale.estado },
    payment: { id: payment.id, monto: payment.monto },
    producto: { id: productState.id, sku: productState.sku, stockActual: productState.stockActual, costoPromedio: productState.costoPromedio },
    cajaGeneral: { id: cashState.id, saldoActual: cashState.saldoActual },
    asientos: journals.map((j) => ({
      id: j.id,
      referencia: j.referencia,
      concepto: j.concepto,
      totalDebito: j.totalDebito,
      totalCredito: j.totalCredito,
      lineas: j.detalles.length
    }))
  };
}

async function main() {
  const result = await seedDemoAccountingOperations();
  console.log('DEMO ACCOUNTING OPERATIONS READY', JSON.stringify(result));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('DEMO ACCOUNTING OPERATIONS ERROR', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { IDS, seedDemoAccountingOperations };
