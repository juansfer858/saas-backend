'use strict';

// P0 Local First: el restaurante debe entrar y permanecer operativo por Edge.
// La nube queda como sincronización/respaldo y no como requisito para abrir la sede.
// Conservamos cualquier política explícita del instalador/tenant; si no existe,
// ampliamos la sesión local a 30 días para tolerar caídas prolongadas de Internet.
const DEFAULT_LOCAL_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

if (!process.env.EDGE_WORKSPACE_SESSION_MS) {
  process.env.EDGE_WORKSPACE_SESSION_MS = String(DEFAULT_LOCAL_SESSION_MS);
}

module.exports = require('./workspace-entry-v59');

module.exports.DEFAULT_LOCAL_SESSION_MS = DEFAULT_LOCAL_SESSION_MS;
