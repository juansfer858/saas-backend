'use strict';

// El bridge debe instalarse antes de que server.js capture global fetch.
// Intercepta las respuestas de /relay/pull para operaciones especiales
// WINDOWS_PRINTERS / WINDOWS_TEST y para el disparo inmediato PRINT_QUEUE.
require('./restaurant-print-bridge');
// V54 mantiene el autopedido offline/LAN, pero durante pruebas elimina sólo el PIN
// de 4 dígitos. La capa base sigue intacta y vuelve al quitar este wrapper.
require('./offline-qr-self-order-v54');
require('./offline-waiter-hard-gate');
// V59 conserva la corrección de redirect V28 y corrige la superficie Mesero del PC:
// muestra todas las mesas, permite abrir una libre y explica si falta carta o permiso.
require('./workspace-entry-v59');
