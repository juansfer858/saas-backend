'use strict';

// El bridge debe instalarse antes de que server.js capture global fetch.
// Intercepta las respuestas de /relay/pull para operaciones especiales
// WINDOWS_PRINTERS / WINDOWS_TEST y para el disparo inmediato PRINT_QUEUE.
require('./restaurant-print-bridge');
require('./offline-qr-self-order');
require('./offline-waiter-hard-gate');
require('./workspace-entry-v28');
