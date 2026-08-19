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

function subdomainFromHost(host) {
  const normalizedHost = normalizeSubdomain(host);
  if (!normalizedHost) return null;

  const baseDomain = normalizeSubdomain(process.env.TENANT_BASE_DOMAIN);

  if (baseDomain && normalizedHost.endsWith(`.${baseDomain}`)) {
    const candidate = normalizedHost.slice(0, -(baseDomain.length + 1));
    return candidate && !candidate.includes('.') ? candidate : null;
  }

  if (normalizedHost === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(normalizedHost)) {
    return null;
  }

  const labels = normalizedHost.split('.');
  return labels.length >= 3 ? labels[0] : null;
}

/**
 * Resuelve el tenant antes de cualquier autenticación o consulta empresarial.
 * El header x-tenant-subdomain se admite para clientes API, pero si el host ya
 * identifica un tenant ambos valores deben coincidir.
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

module.exports = { extractTenantBySubdomain, normalizeSubdomain, subdomainFromHost };
