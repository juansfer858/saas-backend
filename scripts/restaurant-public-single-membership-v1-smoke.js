'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const router = fs.readFileSync('src/modules/public-installer/public-installer.routes.js','utf8');
const js = fs.readFileSync('src/web/restaurant-public-membership-v1.js','utf8');
const css = fs.readFileSync('src/web/restaurant-public-membership-v1.css','utf8');

assert.ok(router.includes('restaurant-public-membership-v1.js'), 'router debe servir JS de membresía única');
assert.ok(router.includes('restaurant-public-membership-v1.css'), 'router debe servir CSS de membresía única');
assert.ok(router.includes('/restaurantes/membership-v1.js'), 'landing debe cargar membership-v1.js');
assert.ok(router.includes('/restaurantes/membership-v1.css'), 'landing debe cargar membership-v1.css');
assert.ok(router.includes('/restaurantes/autopedido-v1.js'), 'autopedido debe mantenerse activo');
assert.ok(router.includes('/restaurantes/responsive-v1.css'), 'responsive público debe mantenerse activo');

assert.ok(js.includes('Una sola membresía · todo incluido'), 'debe vender una sola membresía');
assert.ok(js.includes('$159.900'), 'mensualidad única debe ser 159.900 COP');
assert.ok(js.includes('Implementación desde $800.000 COP'), 'debe mostrar implementación desde 800.000 COP');
assert.ok(js.includes('Pago único · no se repite cada mes'), 'implementación debe quedar separada de la mensualidad');
assert.ok(js.includes('por sede activa'), 'debe aclarar cobro por sede activa');
assert.ok(js.includes('Autopedido y autoatención desde la mesa'), 'autoatención debe estar incluida');
assert.ok(js.includes('Edge · LAN + Cloud'), 'Edge/LAN+Cloud debe estar incluido');
assert.ok(js.includes('Equipos físicos aparte'), 'hardware debe quedar excluido de la mensualidad');
assert.ok(js.includes("href=\"/restaurantes/crear\""), 'CTA debe usar alta genérica sin plan');
assert.ok(!js.includes('$79.900'), 'nuevo asset no debe vender precio Esencial');
assert.ok(!js.includes('$149.900'), 'nuevo asset no debe vender precio Profesional');
assert.ok(!js.includes('$249.900'), 'nuevo asset no debe vender precio Pro Híbrido');
assert.ok(!/fetch\s*\(/.test(js), 'capa comercial no debe llamar APIs');

assert.ok(css.includes('.vr-membership-grid'), 'debe existir layout de membresía única');
assert.ok(css.includes('@media(max-width:640px)'), 'membresía debe adaptarse a móvil');
assert.ok(css.includes('grid-template-columns:1fr'), 'membresía debe colapsar a una columna');

console.log('RESTAURANT PUBLIC SINGLE MEMBERSHIP V1 SMOKE OK');
