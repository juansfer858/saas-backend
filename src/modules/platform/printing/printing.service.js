const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');

const FORMAT_SPECS = {
  TERMICA_58: { widthMm: 58, heightMm: null, kind: 'ROLL', use: 'POS compacto' },
  TERMICA_80: { widthMm: 80, heightMm: null, kind: 'ROLL', use: 'POS retail/restaurante' },
  CARTA: { widthMm: 215.9, heightMm: 279.4, kind: 'SHEET', use: 'Documento formal' },
  MEDIA_CARTA: { widthMm: 139.7, heightMm: 215.9, kind: 'SHEET', use: 'Documento formal compacto' },
  PDF_CARTA: { widthMm: 215.9, heightMm: 279.4, kind: 'PDF', use: 'Representación gráfica digital' },
  PDF_MEDIA_CARTA: { widthMm: 139.7, heightMm: 215.9, kind: 'PDF', use: 'Representación gráfica digital compacta' }
};

function withSpec(config) {
  if (!config) return null;
  return {
    ...config,
    defaultFormatSpec: FORMAT_SPECS[config.defaultFormat],
    invoicePdfFormatSpec: FORMAT_SPECS[config.invoicePdfFormat],
    qrRule: {
      configuredMinimumMm: config.qrMinimumMm,
      legalStatus: 'PENDING_OFFICIAL_ANNEX_SIZE_VERIFICATION',
      note: 'La DIAN exige QR en la representación gráfica; el valor de 20 mm se conserva como piso de producto solicitado y debe validarse contra el anexo técnico vigente antes de etiquetarlo como mínimo legal.'
    }
  };
}

async function getConfig(tenantId) {
  let config = await prisma.printTenantConfig.findUnique({ where: { tenantId }, include: { printers: { orderBy: { name: 'asc' } } } });
  if (!config) {
    config = await prisma.printTenantConfig.create({
      data: { tenantId, defaultFormat: 'TERMICA_80', invoicePdfFormat: 'PDF_CARTA', qrMinimumMm: 20 },
      include: { printers: true }
    });
  }
  return withSpec(config);
}

async function saveConfig(tenantId, userId, input) {
  if (input.qrMinimumMm !== undefined && input.qrMinimumMm < 20) {
    throw new AppError(400, 'VantixGC reserva como mínimo de producto 20 mm para el QR mientras se valida el anexo técnico DIAN vigente', 'PRINT_QR_PRODUCT_FLOOR');
  }
  const row = await prisma.printTenantConfig.upsert({
    where: { tenantId },
    create: { tenantId, ...input, updatedByUserId: userId },
    update: { ...input, updatedByUserId: userId },
    include: { printers: { orderBy: { name: 'asc' } } }
  });
  return withSpec(row);
}

async function savePrinter(tenantId, input) {
  const config = await getConfig(tenantId);
  if (input.transport === 'LAN' && (!input.host || !input.port)) {
    throw new AppError(400, 'Una impresora LAN requiere host y puerto', 'PRINT_LAN_ENDPOINT_REQUIRED');
  }
  if (input.id) {
    const existing = await prisma.printerEndpoint.findFirst({ where: { id: input.id, tenantId } });
    if (!existing) throw new AppError(404, 'Impresora no encontrada', 'PRINT_PRINTER_NOT_FOUND');
    return prisma.printerEndpoint.update({
      where: { id: existing.id },
      data: { name: input.name, transport: input.transport, role: input.role, host: input.host || null, port: input.port || null, format: input.format || null, active: input.active !== false }
    });
  }
  return prisma.printerEndpoint.create({
    data: {
      printConfigId: config.id,
      tenantId,
      name: input.name,
      transport: input.transport,
      role: input.role,
      host: input.host || null,
      port: input.port || null,
      format: input.format || null,
      active: input.active !== false
    }
  });
}

async function listPrinters(tenantId) {
  return prisma.printerEndpoint.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
}

async function printersForRoles(tenantId, roles) {
  const normalized = [...new Set((roles || []).map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
  if (!normalized.length) return [];
  return prisma.printerEndpoint.findMany({
    where: { tenantId, active: true, transport: 'LAN', role: { in: normalized } },
    orderBy: { name: 'asc' }
  });
}

async function buildDirectedJobs(tenantId, input) {
  const groups = input.groups || [];
  const roles = groups.map((group) => String(group.role || '').trim().toUpperCase()).filter(Boolean);
  const printers = await printersForRoles(tenantId, roles);
  const byRole = new Map();
  for (const printer of printers) {
    const key = String(printer.role).toUpperCase();
    if (!byRole.has(key)) byRole.set(key, []);
    byRole.get(key).push(printer);
  }

  const entries = [];
  const missingRoles = [];
  for (const group of groups) {
    const role = String(group.role || '').trim().toUpperCase();
    const targets = byRole.get(role) || [];
    if (!targets.length) {
      missingRoles.push(role);
      continue;
    }
    for (const printer of targets) {
      entries.push({
        stationRole: role,
        target: { id: printer.id, name: printer.name, host: printer.host, port: printer.port || 9100, format: printer.format || null },
        job: {
          title: input.title || 'COMANDA',
          lines: group.lines || [],
          footer: group.footer || input.footer || null,
          copies: group.copies || 1,
          cut: true
        }
      });
    }
  }
  return {
    spooler: { protocol: 'HTTP_LOCAL_TO_RAW_ESC_POS', defaultUrl: 'http://127.0.0.1:18787/print/batch', internetRequired: false },
    entries,
    missingRoles
  };
}

function templateContract(format, qrMinimumMm = 20) {
  const spec = FORMAT_SPECS[format];
  if (!spec) throw new AppError(400, 'Formato de impresión inválido', 'PRINT_FORMAT_INVALID');
  return {
    format,
    ...spec,
    cssPageSize: spec.heightMm ? `${spec.widthMm}mm ${spec.heightMm}mm` : `${spec.widthMm}mm auto`,
    qrBlock: { widthMm: qrMinimumMm, heightMm: qrMinimumMm, standaloneOnNarrowTicket: spec.widthMm <= 58 },
    representationLegend: 'Representación gráfica del documento electrónico; el documento electrónico transmitido/validado es el registro fiscal asociado.'
  };
}

module.exports = { FORMAT_SPECS, getConfig, saveConfig, savePrinter, listPrinters, printersForRoles, buildDirectedJobs, templateContract };
