'use strict';

// El bridge debe instalarse antes de que server.js capture global fetch.
// Intercepta las respuestas de /relay/pull para operaciones especiales
// WINDOWS_PRINTERS / WINDOWS_TEST y para el disparo inmediato PRINT_QUEUE.
require('./restaurant-print-bridge');
// V61 conserva el autopedido directo sin PIN de V54 y agrega nota opcional por
// producto en el QR local/LAN; la nota viaja con la misma línea a Cocina/Barra.
require('./offline-qr-self-order-v61');
require('./offline-waiter-hard-gate');
// V59 conserva la corrección de redirect V28 y corrige la superficie Mesero del PC:
// muestra todas las mesas, permite abrir una libre y explica si falta carta o permiso.
require('./workspace-entry-v59');
