'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const router = fs.readFileSync('src/modules/public-installer/public-installer.routes.js','utf8');
const css = fs.readFileSync('src/web/restaurant-public-responsive-v1.css','utf8');
const js = fs.readFileSync('src/web/restaurant-public-autopedido-v1.js','utf8');

assert.ok(router.includes("restaurant-public-responsive-v1.css"), 'router debe servir responsive-v1');
assert.ok(router.includes("restaurant-public-autopedido-v1.js"), 'router debe servir autopedido-v1');
assert.ok(router.includes('/restaurantes/responsive-v1.css'), 'landing/public pages deben cargar responsive-v1');
assert.ok(router.includes('/restaurantes/autopedido-v1.js'), 'landing debe cargar autopedido-v1');
assert.ok(router.includes('viewport-fit=cover'), 'viewport público debe respetar safe areas');
assert.ok(!router.includes('maximum-scale=1'), 'no se debe bloquear zoom accesible');
assert.ok(!router.includes('user-scalable=no'), 'no se debe bloquear zoom accesible');

assert.ok(css.includes('font-size:16px!important'), 'inputs móviles deben evitar zoom automático de Safari');
assert.ok(css.includes('100dvh'), 'debe usar viewport dinámico con teclado móvil');
assert.ok(css.includes('overflow-x:clip'), 'la superficie pública no debe desbordar horizontalmente');
assert.ok(css.includes('.vr-autopedido-grid'), 'debe existir diseño responsive de autopedido');

assert.ok(js.includes("section.id='autopedido'"), 'debe insertar sección de autopedido');
assert.ok(js.includes('Autopedido · autoatención real'), 'autopedido debe ser protagonista comercial');
assert.ok(js.includes('Hace su propio pedido'), 'debe explicar el pedido autónomo');
assert.ok(js.includes('Cuenta y pago'), 'debe explicar cuenta/pago desde autoatención');
assert.ok(js.includes('Menos carga para el personal'), 'hero debe comunicar optimización de personal');
assert.ok(!/fetch\s*\(/.test(js), 'asset comercial de autopedido no debe llamar APIs');

console.log('RESTAURANT PUBLIC AUTOPEDIDO + RESPONSIVE V1 SMOKE OK');
