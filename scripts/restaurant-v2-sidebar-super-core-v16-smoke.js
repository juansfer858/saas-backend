'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('src/web/restaurant-v2-native-control-p11.html');
const css = read('src/web/restaurant-v2-sidebar-super-core-v16.css');
const panel = read('src/web/panel.html');
const routes = read('src/modules/restaurant/restaurant-v1-retirement-p11.public.routes.js');

function must(condition, message) {
  if (!condition) throw new Error(message);
}

must(panel.includes('--nav:#10241b;--nav2:#173429'), 'Super Core sidebar palette changed; review Restaurant parity');
must(panel.includes('color:#d9e6e0'), 'Super Core navigation text color changed; review Restaurant parity');
must(css.includes('VANTIX_RESTAURANT_V2_SIDEBAR_SUPER_CORE_V16'), 'V16 marker missing');
must(css.includes('--restaurant-sidebar-bg:#10241b'), 'Restaurant sidebar must use Super Core #10241b');
must(css.includes('--restaurant-sidebar-active:#173429'), 'Restaurant active sidebar must use Super Core #173429');
must(css.includes('--restaurant-sidebar-text:#d9e6e0'), 'Restaurant sidebar text must use Super Core #d9e6e0');
must(html.includes('/app/restaurant-v2-sidebar-super-core-v16.css?v=v16'), 'V16 stylesheet not loaded by Restaurant shell');
must(!html.includes('restaurant-v2-sidebar-purple-v15.css'), 'Purple V15 stylesheet must no longer be active');
must(routes.includes("router.get('/app/restaurant-v2-sidebar-super-core-v16.css'"), 'V16 stylesheet route missing');

console.log('Restaurant V2 sidebar matches Super Core palette V16');
