const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const DEFAULT_THEME = Object.freeze({
  preset: 'LA_RIEL_V1',
  restaurantName: null,
  tokens: {
    char: '#201c18',
    bone: '#eee5d6',
    ember: '#c55a34',
    verdigris: '#3f746b',
    brass: '#b28b45',
    paper: '#fffaf1',
    ink: '#2c251f',
    muted: '#756a5d',
    line: '#d4c5b1',
    success: '#58775b',
    danger: '#9c4035'
  },
  typography: {
    display: "Georgia, 'Times New Roman', serif",
    body: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'Courier New', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
  }
});

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_THEME));
}

function publicTheme(config, tenant = null) {
  const base = cloneDefault();
  const stored = config?.themeData && typeof config.themeData === 'object' ? config.themeData : {};
  const tokens = stored.tokens && typeof stored.tokens === 'object' ? stored.tokens : {};
  const typography = stored.typography && typeof stored.typography === 'object' ? stored.typography : {};
  return {
    preset: config?.themePreset || stored.preset || base.preset,
    restaurantName: config?.displayName || stored.restaurantName || tenant?.nombreEmpresa || base.restaurantName,
    tokens: { ...base.tokens, ...tokens },
    typography: { ...base.typography, ...typography },
    editable: true,
    source: config?.themeData ? 'TENANT_OVERRIDE' : 'LA_RIEL_V1_DEFAULT'
  };
}

async function getTheme(tenantId, client = prisma) {
  const [config, tenant] = await Promise.all([
    client.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} }),
    client.tenant.findUnique({ where: { id: tenantId }, select: { nombreEmpresa: true } })
  ]);
  return publicTheme(config, tenant);
}

async function saveTheme(tenantId, userId, input) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, nombreEmpresa: true } });
  if (!tenant) throw new AppError(404, 'Tenant no encontrado', 'RESTAURANT_THEME_TENANT_NOT_FOUND');
  const current = await prisma.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  const before = publicTheme(current, tenant);
  const nextData = {
    preset: input.preset || before.preset,
    restaurantName: Object.prototype.hasOwnProperty.call(input, 'restaurantName') ? input.restaurantName || null : before.restaurantName,
    tokens: { ...before.tokens, ...(input.tokens || {}) },
    typography: { ...before.typography, ...(input.typography || {}) }
  };
  const updated = await prisma.restaurantConfig.update({
    where: { tenantId },
    data: {
      themePreset: nextData.preset,
      displayName: nextData.restaurantName,
      themeData: nextData,
      themeUpdatedByUserId: userId || null
    }
  });
  if (userId) {
    await prisma.auditoriaContable.create({
      data: {
        tenantId,
        userId,
        entidad: 'RESTAURANT_THEME',
        entidadId: tenantId,
        accion: 'UPDATE',
        metadata: { before, after: publicTheme(updated, tenant) }
      }
    });
  }
  return publicTheme(updated, tenant);
}

module.exports = { DEFAULT_THEME, publicTheme, getTheme, saveTheme };
