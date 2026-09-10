'use strict';

const fs=require('node:fs');
const html=fs.readFileSync('src/web/restaurant-v2-waiter-p8.html','utf8');
const css=fs.readFileSync('src/web/restaurant-v2-orders.css','utf8');
const sw=fs.readFileSync('src/web/restaurant-v2-waiter-sw-p8.js','utf8');

function expect(value,message){if(!value)throw new Error(message)}

expect(html.includes('data-waiter-ui="tablet-3col-v22"'),'Mesero no expone marker V22');
expect(html.includes('1 · Mesas'),'falta columna Mesas');
expect(html.includes('2 · Carta'),'falta columna Carta');
expect(html.includes('3 · Revisar pedido'),'falta columna Revisar pedido');
expect(html.includes('/app/restaurant-v2-orders.css?v=v22'),'Mesero no fuerza CSS V22');
expect(!html.includes('restaurant-v2-waiter-tablet-v22.css'),'HTML depende de un asset nuevo no garantizado por rutas');

for(const id of ['tables','menu','draft','review','confirmSend'])expect(html.includes(`id="${id}"`),`se perdió el control operativo #${id}`);
for(const src of ['restaurant-v2-device-sdk-p8.js','restaurant-v2-device-realtime-p8.js','restaurant-v2-orders.js','restaurant-v2-device-pwa-p8.js'])expect(html.includes(src),`se perdió script operativo ${src}`);

expect(css.includes('VANTIX_RESTAURANT_WAITER_TABLET_3COL_V22'),'falta capa visual V22');
expect(css.includes('body[data-vantix-device="waiter"]'),'V22 no está aislado al Mesero');
expect(css.includes('@media(min-width:760px) and (max-width:1199px)'),'falta frontera tablet V22');
expect(css.includes('grid-template-columns:minmax(145px,20vw) minmax(0,1fr) minmax(225px,29vw)'),'tablet no queda en tres columnas');
expect(css.includes('--w22-accent:#0d6b43'),'falta acento visual amigable');
expect(css.includes('linear-gradient(145deg,var(--w22-dark),var(--w22-dark-2))'),'falta encabezado tipo QR');
expect(css.includes('touch-action:manipulation'),'faltan controles táctiles');
expect(css.includes('position:sticky'),'Carta no conserva navegación amigable');

expect(sw.includes("MARKER='VANTIX_RESTAURANT_WAITER_TABLET_3COL_V22'"),'SW no expone V22');
expect(sw.includes("version:'22.0.0'"),'SW no cambió versión');
expect(sw.includes("CACHE='vantixgc-restaurant-v2-waiter-v22'"),'SW no invalida caché anterior');
expect(sw.includes("'/app/restaurant-v2-orders.css?v=v22'"),'SW no precarga CSS V22');
expect(sw.includes('columns:3'),'SW no documenta layout de tres columnas');

console.log('Restaurant Waiter Tablet 3 Columns V22 smoke: OK');
