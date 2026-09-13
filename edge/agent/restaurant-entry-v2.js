'use strict';

// El bridge debe instalarse antes de que server.js capture global fetch.
// Intercepta las respuestas de /relay/pull para operaciones especiales
// WINDOWS_PRINTERS / WINDOWS_TEST y para el disparo inmediato PRINT_QUEUE.
require('./restaurant-print-bridge');
// V61 conserva el autopedido directo sin PIN de V54 y agrega nota opcional por
// producto en el QR local/LAN; la nota viaja con la misma línea a Cocina/Barra.
require('./offline-qr-self-order-v61');
require('./offline-waiter-hard-gate');
// P0 Local First conserva V59 y convierte Edge en la entrada normal de la sede.
// La sesión local dura 30 días por defecto y Core queda como sincronización/respaldo.
require('./workspace-entry-local-first-p0');
