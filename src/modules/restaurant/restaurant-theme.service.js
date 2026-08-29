const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const PANEL_FONT = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const PANEL_TYPOGRAPHY = Object.freeze({
  display: PANEL_FONT,
  body: PANEL_FONT,
  mono: PANEL_FONT
});

const DEFAULT_SPOTLIGHT = Object.freeze({
  active: false,
  kind: 'PLATO_DIA',
  menuItemId: null,
  label: 'Plato del día',
  description: null
});

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
  typography: PANEL_TYPOGRAPHY,
  clientSpotlight: DEFAULT_SPOTLIGHT
});

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_THEME));
}

function normalizeSpotlight(value) {
  const stored = value && typeof value === 'object' ? value : {};
  const kind = stored.kind === 'PROMO_DIA' ? 'PROMO_DIA' : 'PLATO_DIA';
  const fallbackLabel = kind === 'PROMO_DIA' ? 'Promo del día' : 'Plato del día';
  return {
    active: Boolean(stored.active && stored.menuItemId),
    kind,
    menuItemId: stored.menuItemId || null,
    label: String(stored.label || fallbackLabel).trim().slice(0, 60),
    description: stored.description ? String(stored.description).trim().slice(0, 180) : null
  };
}

function publicTheme(config, tenant = null) {
  const base = cloneDefault();
  const stored = config?.themeData && typeof config.themeData === 'object' ? config.themeData : {};
  const tokens = stored.tokens && typeof stored.tokens === 'object' ? stored.tokens : {};
  return {
    preset: config?.themePreset || stored.preset || base.preset,
    restaurantName: config?.displayName || stored.restaurantName || tenant?.nombreEmpresa || base.restaurantName,
    tokens: { ...base.tokens, ...tokens },
    typography: { ...PANEL_TYPOGRAPHY },
    clientSpotlight: normalizeSpotlight(stored.clientSpotlight || base.clientSpotlight),
    typographyLockedToPanel: true,
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

async function validateSpotlight(tenantId, value) {
  const spotlight = normalizeSpotlight(value);
  if (!value?.active) return { ...spotlight, active: false };
  if (!spotlight.menuItemId) throw new AppError(400, 'Selecciona un producto de la carta para publicarlo', 'RESTAURANT_SPOTLIGHT_MENU_ITEM_REQUIRED');

  const menu = await prisma.restaurantMenuItem.findFirst({
    where: { id: spotlight.menuItemId, tenantId, active: true }
  });
  if (!menu) throw new AppError(404, 'El producto seleccionado ya no pertenece a la carta activa', 'RESTAURANT_SPOTLIGHT_MENU_ITEM_INVALID');

  const product = await prisma.producto.findFirst({ where: { id: menu.productId, tenantId, activo: true } });
  if (!product) throw new AppError(409, 'El producto seleccionado no está disponible', 'RESTAURANT_SPOTLIGHT_PRODUCT_INVALID');

  if (menu.requiresRecipe) {
    const recipe = await prisma.consumptionRecipe.findFirst({ where: { tenantId, outputProductId: product.id, active: true }, select: { id: true } });
    if (!recipe) throw new AppError(409, `Configura la receta de ${product.nombre} antes de publicarlo`, 'RESTAURANT_SPOTLIGHT_RECIPE_REQUIRED');
  }
  return { ...spotlight, active: true };
}

async function saveTheme(tenantId, userId, input) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, nombreEmpresa: true } });
  if (!tenant) throw new AppError(404, 'Tenant no encontrado', 'RESTAURANT_THEME_TENANT_NOT_FOUND');
  const current = await prisma.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  const before = publicTheme(current, tenant);
  const stored = current?.themeData && typeof current.themeData === 'object' ? current.themeData : {};
  const hasSpotlight = Object.prototype.hasOwnProperty.call(input, 'clientSpotlight');
  const nextSpotlight = hasSpotlight ? await validateSpotlight(tenantId, input.clientSpotlight) : before.clientSpotlight;
  const nextData = {
    ...stored,
    preset: input.preset || before.preset,
    restaurantName: Object.prototype.hasOwnProperty.call(input, 'restaurantName') ? input.restaurantName || null : before.restaurantName,
    tokens: { ...before.tokens, ...(input.tokens || {}) },
    typography: { ...PANEL_TYPOGRAPHY },
    clientSpotlight: nextSpotlight
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
        entidad: hasSpotlight ? 'RESTAURANT_CLIENT_SPOTLIGHT' : 'RESTAURANT_THEME',
        entidadId: tenantId,
        accion: 'UPDATE',
        metadata: { before, after: publicTheme(updated, tenant) }
      }
    });
  }
  return publicTheme(updated, tenant);
}

module.exports = { PANEL_FONT, PANEL_TYPOGRAPHY, DEFAULT_THEME, DEFAULT_SPOTLIGHT, publicTheme, getTheme, saveTheme };
