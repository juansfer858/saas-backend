'use strict';

const fs = require('node:fs');

const html = fs.readFileSync('src/web/restaurant-v2-native-control-p11.html', 'utf8');
const css = fs.readFileSync('src/web/restaurant-v2-sidebar-purple-v15.css', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-v1-retirement-p11.public.routes.js', 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(css.includes('VANTIX_RESTAURANT_SIDEBAR_PURPLE_V15'), 'falta marker V15');
expect(css.includes('--restaurant-sidebar-purple:#8B5CF6'), 'falta morado base #8B5CF6');
expect(css.includes('--restaurant-sidebar-purple-active:#6D28D9'), 'falta morado activo #6D28D9');
expect(css.includes('.p11-side{'), 'V15 no aplica al panel lateral');
expect(css.includes('.p11-nav button.active'), 'V15 no define estado activo');
expect(html.includes('/app/restaurant-v2-sidebar-purple-v15.css?v=v15'), 'shell P11 no carga V15');
expect(
  html.indexOf('restaurant-v2-native-control-p11.css') < html.indexOf('restaurant-v2-sidebar-purple-v15.css'),
  'V15 debe cargarse después del CSS base P11'
);
expect(routes.includes("router.get('/app/restaurant-v2-sidebar-purple-v15.css'"), 'falta ruta pública V15');

console.log('Restaurant V2 Sidebar Purple V15 smoke: OK');
