'use strict';

const VERTICALS = Object.freeze({
  RESTAURANT: Object.freeze({
    code: 'RESTAURANT',
    aliases: Object.freeze(['RESTAURANTE']),
    label: 'VantixGC Restaurantes',
    state: 'AVAILABLE',
    localFirst: true,
    cloudAppPath: '/app/centro-de-control',
    edgeAdapter: 'restaurant',
    edgeWorkspace: 'restaurant',
    capabilities: Object.freeze([
      'TABLES', 'WAITER', 'ORDERS', 'KDS', 'CASH_SHIFT', 'LOCAL_PRINT', 'REMOTE_ORDER_CHANNELS'
    ])
  }),
  LITHOGRAPHY: Object.freeze({
    code: 'LITHOGRAPHY',
    aliases: Object.freeze(['LITOGRAFIA']),
    label: 'VantixGC Litografía',
    state: 'RESERVED',
    localFirst: false,
    cloudAppPath: null,
    edgeAdapter: null,
    edgeWorkspace: null,
    capabilities: Object.freeze([])
  }),
  PETS: Object.freeze({
    code: 'PETS',
    aliases: Object.freeze(['MASCOTAS']),
    label: 'VantixGC Mascotas',
    state: 'RESERVED',
    localFirst: false,
    cloudAppPath: null,
    edgeAdapter: null,
    edgeWorkspace: null,
    capabilities: Object.freeze([])
  })
});

function normalizeVerticalCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw || raw === 'CORE') return null;
  if (VERTICALS[raw]) return raw;
  for (const vertical of Object.values(VERTICALS)) {
    if (vertical.aliases.includes(raw)) return vertical.code;
  }
  return null;
}

function getVertical(value) {
  const code = normalizeVerticalCode(value);
  return code ? VERTICALS[code] : null;
}

function listVerticals() {
  return Object.values(VERTICALS).map((vertical) => ({
    code: vertical.code,
    label: vertical.label,
    state: vertical.state,
    localFirst: vertical.localFirst,
    cloudAppPath: vertical.cloudAppPath,
    edgeAdapter: vertical.edgeAdapter,
    edgeWorkspace: vertical.edgeWorkspace,
    capabilities: [...vertical.capabilities]
  }));
}

function requireAvailableVertical(value) {
  const vertical = getVertical(value);
  if (!vertical || vertical.state !== 'AVAILABLE') {
    const error = new Error(`Vertical VantixGC no disponible: ${value}`);
    error.code = 'VERTICAL_NOT_AVAILABLE';
    throw error;
  }
  return vertical;
}

module.exports = {
  VERTICALS,
  normalizeVerticalCode,
  getVertical,
  listVerticals,
  requireAvailableVertical
};
