'use strict';

const { prisma } = require('../../config/prisma');

const MARKER = 'VANTIX_RESTAURANT_BUSINESS_AUDIT_C85';
const VERSION = '85.0.0';
const AUDIT_ENTITY = 'RESTAURANT_BUSINESS_AUDIT_C85';
const RESTAURANT_NICHES = new Set(['RESTAURANTE', 'RESTAURANT']);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TENANT_CACHE_TTL_MS = 5 * 60 * 1000;
const tenantCache = new Map();

const SENSITIVE_KEY = /^(password|passwd|contrasena|contraseña|token|accessToken|refreshToken|authorization|cookie|secret|clientSecret|apiKey|apikey|pin|cvv|cvc|cardNumber|numeroTarjeta|numeroDeTarjeta)$/i;
const NOISY_PATH = /(heartbeat|presence|presencia|ack|poll|telemetry|telemetria|service-worker|push-v65|device-heartbeat|sync-now|realtime|waiter-call|llamar-mesero|kds|pedido-borrador|draft)/i;

function trimString(value, max = 1000) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return trimString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[BUFFER ${value.length} bytes]`;
  if (depth >= 5) return '[TRUNCATED]';
  if (typeof value !== 'object') return trimString(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitize(item, depth + 1, seen));
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitize(item, depth + 1, seen);
  }
  return out;
}

function subjectForPath(pathname) {
  const p = String(pathname || '').toLowerCase();
  if (/(producto|product)/.test(p)) return 'PRODUCTO';
  if (/(categor)/.test(p)) return 'CATEGORIA';
  if (/(receta|recipe)/.test(p)) return 'RECETA';
  if (/(menu|carta)/.test(p)) return 'CARTA';
  if (/(factura|comprobante|devolucion|venta|comercial)/.test(p)) return 'VENTA';
  if (/(caja|cash|arqueo|turno)/.test(p)) return 'CAJA';
  if (/(tercero|cliente|customer)/.test(p)) return 'CLIENTE';
  if (/(empleado|employee|usuario)/.test(p)) return 'EMPLEADO';
  if (/(pago|payment)/.test(p)) return 'PAGO';
  if (/(inventario|kardex|stock)/.test(p)) return 'INVENTARIO';
  if (/(tesoreria|recaudo)/.test(p)) return 'TESORERIA';
  if (/(zona)/.test(p)) return 'ZONA';
  if (/(mesa)/.test(p)) return 'MESA';
  if (/(seguridad|rol|permiso)/.test(p)) return 'SEGURIDAD';
  if (/(theme|config|gates|empresa|impresion)/.test(p)) return 'CONFIGURACION';
  return 'REGISTRO';
}

function moduleForPath(pathname) {
  const p = String(pathname || '').toLowerCase();
  if (p.startsWith('/terceros')) return 'CLIENTES';
  if (p.startsWith('/inventario')) return 'INVENTARIO';
  if (p.startsWith('/tesoreria')) return 'TESORERIA';
  if (p.startsWith('/pagos')) return 'PAGOS';
  if (p.startsWith('/comercial')) return 'VENTAS';
  if (p.startsWith('/usuarios')) return 'EMPLEADOS';
  if (p.startsWith('/seguridad')) return 'SEGURIDAD';
  if (p.startsWith('/impresion/empresa')) return 'CONFIGURACION';
  if (p.startsWith('/restaurante')) {
    const subject = subjectForPath(p);
    if (['PRODUCTO', 'CATEGORIA', 'RECETA', 'CARTA'].includes(subject)) return 'CARTA';
    if (subject === 'CAJA') return 'CAJA';
    if (subject === 'CLIENTE') return 'CLIENTES';
    if (subject === 'EMPLEADO') return 'EMPLEADOS';
    if (subject === 'CONFIGURACION' || subject === 'ZONA' || subject === 'MESA') return 'CONFIGURACION';
  }
  return null;
}

function restaurantAdminPathAllowed(method, pathname) {
  const p = String(pathname || '').toLowerCase();
  if (!p.startsWith('/restaurante/')) return false;
  if (/^\/restaurante\/limpieza-pruebas\//.test(p)) return false; // ya tiene auditoría propia C83/V68
  if (/^\/restaurante\/auditoria\//.test(p)) return false;
  if (NOISY_PATH.test(p)) return false;
  if (/^\/restaurante\/(theme|config|gates)(\/|$)/.test(p)) return true;
  if (/^\/restaurante\/(menu|carta|categor|categorias|receta|recetas|producto|productos)(\/|$)/.test(p)) return true;
  if (/^\/restaurante\/(credito|credit|caja|cash)(\/|$)/.test(p)) return true;
  if (/^\/restaurante\/(empleado|empleados|employee|employees)(\/|$)/.test(p)) return true;
  if (/^\/restaurante\/zonas(\/|$)/.test(p)) return true;
  if (/^\/restaurante\/mesas\/?$/.test(p) && method === 'POST') return true;
  if (/^\/restaurante\/mesas\/[^/]+\/?$/.test(p) && ['PUT', 'PATCH', 'DELETE'].includes(method)) return true;
  if (/^\/restaurante\/mesas\/[^/]+\/qr\/regenerar\/?$/.test(p)) return true;
  return false;
}

function classifyMutation(method, pathname) {
  const verb = String(method || '').toUpperCase();
  const path = String(pathname || '').split('?')[0];
  if (!MUTATION_METHODS.has(verb) || NOISY_PATH.test(path)) return null;

  const broadAllowed = ['/terceros', '/inventario', '/tesoreria', '/pagos', '/comercial', '/usuarios', '/seguridad']
    .some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  const printAllowed = path === '/impresion/empresa' || path.startsWith('/impresion/empresa/');
  const restaurantAllowed = restaurantAdminPathAllowed(verb, path);
  if (!broadAllowed && !printAllowed && !restaurantAllowed) return null;

  const module = moduleForPath(path);
  if (!module) return null;
  const subject = subjectForPath(path);
  const actionVerb = verb === 'POST' ? 'CREATE' : verb === 'DELETE' ? 'DELETE' : 'UPDATE';
  return {
    module,
    subject,
    action: `${actionVerb}_${subject}`,
    label: `${actionVerb === 'CREATE' ? 'Crear' : actionVerb === 'DELETE' ? 'Eliminar' : 'Modificar'} ${subject.toLowerCase()}`
  };
}

async function isRestaurantTenant(tenantId, client = prisma) {
  if (!tenantId) return false;
  const cached = tenantCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const tenant = await client.tenant.findUnique({ where: { id: tenantId }, select: { nicho: true } });
  const value = RESTAURANT_NICHES.has(String(tenant?.nicho || '').trim().toUpperCase());
  tenantCache.set(tenantId, { value, expiresAt: Date.now() + TENANT_CACHE_TTL_MS });
  return value;
}

function entityIdFrom({ req, responseBody }) {
  const body = responseBody && typeof responseBody === 'object' ? responseBody : {};
  return String(
    req?.params?.id
    || req?.params?.productId
    || req?.params?.terceroId
    || req?.params?.ventaId
    || body?.data?.id
    || body?.id
    || req?.tenantId
    || 'unknown'
  );
}

async function recordMutation({ req, responseBody, statusCode, classification }, client = prisma) {
  if (!classification || !req?.tenantId || !req?.userId) return null;
  if (!(await isRestaurantTenant(req.tenantId, client))) return null;
  const metadata = {
    marker: MARKER,
    version: VERSION,
    module: classification.module,
    subject: classification.subject,
    label: classification.label,
    method: String(req.method || '').toUpperCase(),
    path: String(req.originalUrl || req.url || req.path || '').split('?')[0],
    statusCode: Number(statusCode || 0),
    recordId: entityIdFrom({ req, responseBody }),
    changes: sanitize(req.body || null),
    params: sanitize(req.params || null),
    query: sanitize(req.query || null),
    result: sanitize(responseBody?.data ?? responseBody ?? null),
    origin: {
      ip: trimString(req.ip || req.socket?.remoteAddress || '', 120) || null,
      userAgent: trimString(req.get?.('user-agent') || '', 300) || null
    }
  };
  return client.auditoriaContable.create({
    data: {
      tenantId: req.tenantId,
      userId: req.userId,
      entidad: AUDIT_ENTITY,
      entidadId: metadata.recordId,
      accion: classification.action,
      metadata
    }
  });
}

module.exports = {
  MARKER,
  VERSION,
  AUDIT_ENTITY,
  sanitize,
  subjectForPath,
  moduleForPath,
  restaurantAdminPathAllowed,
  classifyMutation,
  isRestaurantTenant,
  entityIdFrom,
  recordMutation
};
