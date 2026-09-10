'use strict';

const fs = require('node:fs');

const html = fs.readFileSync('src/web/restaurant-v2-native-control-p11.html', 'utf8');
const css = fs.readFileSync('src/web/restaurant-v2-sidebar-graphite-v17.css', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-v1-retirement-p11.public.routes.js', 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(css.includes('VANTIX_RESTAURANT_V2_SIDEBAR_GRAPHITE_V17'), 'falta marker V17');
expect(css.includes('--restaurant-sidebar-graphite:#111827'), 'falta grafito base #111827');
expect(css.includes('--restaurant-sidebar-graphite-active:#1f2937'), 'falta grafito activo #1F2937');
expect(css.includes('--restaurant-sidebar-accent:#3b82f6'), 'falta acento azul del Super Core');
expect(css.includes('.p11-side{'), 'V17 no aplica al panel lateral real');
expect(css.includes('.p11-nav button.active'), 'V17 no define estado activo');
expect(html.includes('/app/restaurant-v2-sidebar-graphite-v17.css?v=v17'), 'shell P11 no carga V17');
expect(
  html.indexOf('restaurant-v2-sidebar-super-core-v16.css') < html.indexOf('restaurant-v2-sidebar-graphite-v17.css'),
  'V17 debe cargarse después de V16 para eliminar el tinte verde'
);
expect(routes.includes("router.get('/app/restaurant-v2-sidebar-graphite-v17.css'"), 'falta ruta pública V17');

console.log('Restaurant V2 Sidebar Graphite V17 smoke: OK');
