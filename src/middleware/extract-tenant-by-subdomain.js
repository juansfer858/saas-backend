const { prisma } = require('../config/prisma');
const { AppError } = require('../utils/app-error');

function normalizeSubdomain(value) {
  if (!value || typeof value !== 'string') return null;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split(':')[0]
    .replace(/\.$/, '');

  return normalized || null;
}

function platformSubdomains() {
  return new Set(
    String(process.env.TENANT_PLATFORM_SUBDOMAINS || 'core')
      .split(',')
      .map((value) => normalizeSubdomain(value))
      .filter(Boolean)
  );
}

function subdomainFromHost(host) {
  const normalizedHost = normalizeSubdomain(host);
  if (!normalizedHost) return null;

  const baseDomain = normalizeSubdomain(process.env.TENANT_BASE_DOMAIN);

  if (baseDomain && normalizedHost.endsWith(`.${baseDomain}`)) {
    const candidate = normalizedHost.slice(0, -(baseDomain.length + 1));
    if (!candidate || candidate.includes('.') || platformSubdomains().has(candidate)) return null;
    return candidate;
  }

  if (normalizedHost === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(normalizedHost)) {
    return null;
  }

  const labels = normalizedHost.split('.');
  const candidate = labels.length >= 3 ? labels[0] : null;
  return candidate && !platformSubdomains().has(candidate) ? candidate : null;
}

/**
 * Resuelve el tenant antes de cualquier autenticación o consulta empresarial.
 * En dominios de tenant, el host manda y cualquier header debe coincidir.
 * En el host de plataforma (por defecto `core`) se permite seleccionar el tenant
 * explícitamente con x-tenant-subdomain; esto habilita el panel administrativo
 * central sin relajar el aislamiento por tenantId.
 */
async function extractTenantBySubdomain(req, _res, next) {
  try {
    const customSubdomain = normalizeSubdomain(req.headers['x-tenant-subdomain']);
    const hostSubdomain = subdomainFromHost(req.headers.host);

    if (customSubdomain && hostSubdomain && customSubdomain !== hostSubdomain) {
      throw new AppError(
        400,
        'El subdominio del header no coincide con el host',
        'TENANT_SUBDOMAIN_MISMATCH'
      );
    }

    const subdomain = customSubdomain || hostSubdomain;

    if (!subdomain) {
      throw new AppError(
        400,
        'No fue posible determinar el subdominio del tenant',
        'TENANT_SUBDOMAIN_REQUIRED'
      );
    }

    const tenant = await prisma.tenant.findUnique({
      where: { subdomain },
      select: {
        id: true,
        subdomain: true,
        nombreEmpresa: true,
        pais: true,
        moneda: true,
        activo: true
      }
    });

    if (!tenant) {
      throw new AppError(404, 'Empresa no encontrada', 'TENANT_NOT_FOUND');
    }

    if (!tenant.activo) {
      throw new AppError(403, 'Empresa inactiva', 'TENANT_INACTIVE');
    }

    req.tenantId = tenant.id;
    req.tenant = tenant;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { extractTenantBySubdomain, normalizeSubdomain, subdomainFromHost, platformSubdomains };
