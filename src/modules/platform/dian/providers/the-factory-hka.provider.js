const { AppError } = require('../../../../utils/app-error');

const PROVIDER_CODE = 'THE_FACTORY_HKA';
const OFFICIAL_DEMO_BASE = 'https://demoapi-de.thefactoryhka.com.co';
const OFFICIAL_PRODUCTION_BASE = 'https://api-de.thefactoryhka.com.co';

function readiness(config, credentials) {
  const missing = [];
  if (!credentials?.tokenEmpresa) missing.push('tokenEmpresa');
  if (!credentials?.tokenPassword) missing.push('tokenPassword');
  if (!credentials?.documentEquivalentSendUrl) missing.push('documentEquivalentSendUrl');
  if (!credentials?.facturaTemplate || typeof credentials.facturaTemplate !== 'object') missing.push('facturaTemplate');
  return {
    providerCode: PROVIDER_CODE,
    installed: true,
    configured: missing.length === 0,
    missing,
    supportedDocumentTypes: ['DOCUMENTO_EQUIVALENTE_POS'],
    officialBases: { demo: OFFICIAL_DEMO_BASE, habilitacionAndProduction: OFFICIAL_PRODUCTION_BASE },
    note: 'La URL completa del método EnviarRequest y la plantilla FacturaGeneral deben provenir del onboarding técnico del PT; VantixGC no inventa rutas ni campos fiscales.'
  };
}

function formatHkaDate(value) {
  const d = new Date(value || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function decimalString(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function replaceTemplate(value, vars) {
  if (Array.isArray(value)) return value.map((x) => replaceTemplate(x, vars));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = replaceTemplate(child, vars);
    return out;
  }
  if (typeof value !== 'string') return value;
  const exact = value.match(/^\{\{([^}]+)\}\}$/);
  if (exact && Object.prototype.hasOwnProperty.call(vars, exact[1])) return vars[exact[1]];
  return value.replace(/\{\{([^}]+)\}\}/g, (_m, key) => Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : '');
}

async function buildInvoice({ document, origin, credentials }) {
  const template = credentials.facturaTemplate;
  if (!template || typeof template !== 'object') throw new AppError(409, 'Configure facturaTemplate entregada/validada con The Factory HKA', 'HKA_FACTURA_TEMPLATE_REQUIRED');
  if (!origin) throw new AppError(409, 'No fue posible cargar la venta origen para transmitir a HKA', 'HKA_ORIGIN_REQUIRED');

  const vars = {
    fiscalNumber: document.fiscalNumber,
    internalNumber: document.internalNumber || origin.numero,
    issueDateTime: formatHkaDate(origin.fecha),
    subtotal: decimalString(origin.subtotal),
    ivaTotal: decimalString(origin.ivaTotal),
    impoconsumoTotal: decimalString(origin.impoconsumoTotal),
    total: decimalString(origin.total),
    customerId: origin.tercero?.identificacion || '222222222222',
    customerName: origin.tercero?.razonSocial || origin.tercero?.nombre || 'Consumidor final',
    customerEmail: origin.tercero?.email || '',
    customerPhone: origin.tercero?.telefono || ''
  };
  const factura = replaceTemplate(deepClone(template), vars);
  factura.consecutivoDocumento = document.fiscalNumber;
  factura.fechaEmision = vars.issueDateTime;
  if (!factura.tipoDocumento) factura.tipoDocumento = '20';

  if (credentials.autoBuildDetails === true) {
    factura.detalleDeFactura = (origin.detalles || []).map((line, index) => ({
      ...(credentials.detailTemplate ? replaceTemplate(deepClone(credentials.detailTemplate), {
        lineNumber: index + 1,
        sku: line.producto?.sku || '',
        description: line.descripcion || line.producto?.nombre || '',
        quantity: String(Number(line.cantidad || 0)),
        unitPrice: decimalString(line.precioUnitario),
        lineSubtotal: decimalString(line.subtotalLinea),
        lineTax: decimalString(line.ivaValor),
        lineTotal: decimalString(line.totalLinea),
        ivaPct: String(Number(line.ivaPct || 0))
      }) : {})
    }));
  }

  return factura;
}

function normalizeResponse(body, httpStatus) {
  const code = Number(body?.codigo ?? httpStatus);
  const resultText = String(body?.resultado || '').toLowerCase();
  const dianValid = body?.esValidoDian;
  const accepted = httpStatus >= 200 && httpStatus < 300 &&
    (code === 200 || code === 201 || resultText === 'procesado') && dianValid !== false;
  return {
    accepted,
    requestId: body?.consecutivoDocumento || body?.requestId || null,
    uniqueCode: body?.cufe || body?.cude || body?.uuid || null,
    uniqueCodeType: body?.tipoCufe || body?.tipoCUFE || 'CUDE',
    response: body,
    rejectionMessage: body?.mensaje || (Array.isArray(body?.mensajesValidacion) ? body.mensajesValidacion.join(' | ') : null)
  };
}

async function transmit({ document, config, credentials, origin, fetchImpl = globalThis.fetch }) {
  const state = readiness(config, credentials);
  if (!state.configured) throw new AppError(409, `Configuración HKA incompleta: ${state.missing.join(', ')}`, 'HKA_CONFIG_INCOMPLETE', state);
  if (document.documentType !== 'DOCUMENTO_EQUIVALENTE_POS') {
    throw new AppError(409, `El adaptador HKA V1 habilita primero Documento Equivalente POS; ${document.documentType} requiere adaptador específico`, 'HKA_DOCUMENT_TYPE_NOT_SUPPORTED');
  }
  if (typeof fetchImpl !== 'function') throw new Error('Fetch HTTP no disponible');

  const factura = await buildInvoice({ document, origin, credentials });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(credentials.timeoutMs || 15000));
  let response;
  try {
    response = await fetchImpl(credentials.documentEquivalentSendUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ tokenEmpresa: credentials.tokenEmpresa, tokenPassword: credentials.tokenPassword, factura }),
      signal: controller.signal
    });
  } catch (error) {
    const wrapped = new Error(`No fue posible conectar con The Factory HKA: ${error.message}`);
    wrapped.retryable = true;
    throw wrapped;
  } finally {
    clearTimeout(timeout);
  }

  let body = null;
  try { body = await response.json(); }
  catch { body = { mensaje: await response.text().catch(() => ''), resultado: 'Error' }; }
  const normalized = normalizeResponse(body, response.status);
  if (!normalized.accepted) {
    const error = new Error(normalized.rejectionMessage || `HKA rechazó el documento (HTTP ${response.status})`);
    error.retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    error.providerResponse = body;
    error.httpStatus = response.status;
    throw error;
  }
  return normalized;
}

module.exports = { PROVIDER_CODE, OFFICIAL_DEMO_BASE, OFFICIAL_PRODUCTION_BASE, readiness, buildInvoice, normalizeResponse, transmit };
