'use strict';

const fs = require('node:fs');

const html = fs.readFileSync('src/web/restaurant-v2-native-control-p11.html', 'utf8');
const css = fs.readFileSync('src/web/restaurant-v2-sidebar-purple-v15.css', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-v1-retirement-p11.public.routes.js', 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(css.includes('VANTIX_RESTAURANT_SIDEBAR_PURPLE_V15'), 'falta marker histórico V15');
expect(css.includes('--restaurant-sidebar-purple:#8B5CF6'), 'falta morado base histórico #8B5CF6');
expect(css.includes('--restaurant-sidebar-purple-active:#6D28D9'), 'falta morado activo histórico #6D28D9');
expect(css.includes('.p11-side{'), 'V15 histórico no conserva su panel lateral');
expect(css.includes('.p11-nav button.active'), 'V15 histórico no conserva estado activo');
expect(routes.includes("router.get('/app/restaurant-v2-sidebar-purple-v15.css'"), 'falta ruta de rescate V15');

const v16Active = html.includes('/app/restaurant-v2-sidebar-super-core-v16.css?v=v16');
if (v16Active) {
  expect(!html.includes('/app/restaurant-v2-sidebar-purple-v15.css?v=v15'), 'V15 no debe seguir activo cuando V16 está cargado');
  console.log('Restaurant V2 Sidebar Purple V15 smoke: histórico / sustituido por V16');
} else {
  expect(html.includes('/app/restaurant-v2-sidebar-purple-v15.css?v=v15'), 'shell P11 no carga V15');
  expect(
    html.indexOf('restaurant-v2-native-control-p11.css') < html.indexOf('restaurant-v2-sidebar-purple-v15.css'),
    'V15 debe cargarse después del CSS base P11'
  );
  console.log('Restaurant V2 Sidebar Purple V15 smoke: OK');
}
