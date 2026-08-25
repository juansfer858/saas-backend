const { prisma } = require('../../config/prisma');
const queryService = require('./sales-query.service');
const { toExcelHtml, toSimplePdf } = require('../accounting/accounting-export.service');
const { AppError } = require('../../utils/app-error');

function numberValue(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function dashboardSpec(tenant, analytics) {
  const rows = [];
  const rowStyles = [];
  const push = (style, section, code, concept, quantity, value) => {
    rows.push([section, code, concept, quantity, value]);
    rowStyles.push(style);
  };

  push('section', 'IDENTIFICACIÓN DEL INFORME', '', '', '', '');
  push('data', '', 'Empresa', tenant.nombreEmpresa || tenant.subdomain, '', '');
  push('data', '', 'NIT', tenant.nit || '—', '', '');
  push('data', '', 'Nicho / actividad', tenant.nicho || 'CORE', '', '');
  push('data', '', 'Subdominio', tenant.subdomain, '', '');
  push('data', '', 'Moneda', tenant.moneda || 'COP', '', '');
  push('data', '', 'Generado', new Date().toISOString(), '', '');

  const k = analytics.kpis || {};
  push('section', 'RESUMEN EJECUTIVO', '', '', '', '');
  push('data', '', 'Ventas de hoy', '', numberValue(k.ventasHoy));
  push('data', '', 'Ventas del mes', numberValue(k.ventasMesCantidad), numberValue(k.ventasMes));
  push('data', '', 'Ticket promedio', '', numberValue(k.ticketPromedio));
  push('data', '', 'Cartera pendiente', numberValue(k.carteraDocumentos), numberValue(k.carteraPendiente));

  push('section', 'VENTAS ÚLTIMOS 7 DÍAS', '', '', '', '');
  for (const day of analytics.salesByDay || []) {
    push('data', '', day.date || '', `Documentos: ${numberValue(day.count)}`, numberValue(day.count), numberValue(day.total));
  }

  push('section', 'TOP PRODUCTOS DEL MES', '', '', '', '');
  (analytics.topProducts || []).forEach((item, index) => {
    push('data', '', `${index + 1}. ${item.nombre || 'Producto'}`, item.sku || '', numberValue(item.cantidad), numberValue(item.ventas));
  });
  if (!(analytics.topProducts || []).length) push('data', '', 'Sin productos vendidos en el periodo', '', 0, 0);

  const indicators = analytics.indicators || {};
  push('section', 'INDICADORES DEL NEGOCIO', '', '', '', '');
  push('data', '', 'Productos activos', '', numberValue(indicators.productosActivos), '');
  push('data', '', 'Stock crítico', 'Existencia ≤ 5', numberValue(indicators.stockCritico), '');
  push('data', '', 'Documentos de cartera abiertos', '', numberValue(k.carteraDocumentos), numberValue(k.carteraPendiente));

  return {
    title: `Informe Ejecutivo Dashboard - ${tenant.nombreEmpresa || tenant.subdomain}`,
    headers: ['Sección', 'Código / Fecha', 'Concepto / Detalle', 'Cantidad', 'Valor'],
    columns: [
      { label: 'Sección', width: 0.18, type: 'text', align: 'left' },
      { label: 'Código / Fecha', width: 0.16, type: 'text', align: 'left' },
      { label: 'Concepto / Detalle', width: 0.36, type: 'text', align: 'left' },
      { label: 'Cantidad', width: 0.12, type: 'number', align: 'right' },
      { label: 'Valor', width: 0.18, type: 'number', align: 'right' }
    ],
    rows,
    rowStyles
  };
}

async function exportDashboard(tenantId, format, filters = {}) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, nit: true, nombreEmpresa: true, subdomain: true, nicho: true, moneda: true, pais: true }
  });
  if (!tenant) throw new AppError(404, 'Empresa no encontrada', 'TENANT_NOT_FOUND');
  const analytics = await queryService.dashboard(tenantId, filters);
  const spec = dashboardSpec(tenant, analytics);
  const normalized = String(format || '').toLowerCase();
  if (['xls', 'excel'].includes(normalized)) {
    return { buffer: toExcelHtml(spec), mime: 'application/vnd.ms-excel', extension: 'xls', title: spec.title };
  }
  if (normalized === 'pdf') {
    return { buffer: toSimplePdf(spec), mime: 'application/pdf', extension: 'pdf', title: spec.title };
  }
  throw new AppError(400, 'Formato de informe no soportado', 'DASHBOARD_REPORT_FORMAT_INVALID');
}

module.exports = { exportDashboard, dashboardSpec };
