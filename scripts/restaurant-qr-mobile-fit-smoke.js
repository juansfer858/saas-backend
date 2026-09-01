'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('src/web/restaurant-qr.html', 'utf8');
const mobile = fs.readFileSync('src/web/restaurant-qr-mobile-fit.js', 'utf8');
const edgeFallback = fs.readFileSync('src/web/restaurant-qr-edge-fallback-ui.js', 'utf8');
const visit = fs.readFileSync('src/web/restaurant-qr-visit-ui.js', 'utf8');
const tracking = fs.readFileSync('src/web/restaurant-qr-tracking-ui.js', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-visit.public.routes.js', 'utf8');

assert.match(html, /name="viewport"[^>]+width=device-width[^>]+initial-scale=1/, 'QR HTML must start at device width and scale 1');
assert.doesNotMatch(html, /user-scalable\s*=\s*no/i, 'QR HTML must not disable user zoom');

assert.match(mobile, /minimum-scale=1/, 'mobile guard must normalize initial viewport scale');
assert.match(mobile, /100dvw/, 'mobile guard must cap layout to dynamic device width');
assert.match(mobile, /100dvh/, 'mobile guard must use dynamic viewport height');
assert.match(mobile, /overflow-x:(hidden|clip)/, 'mobile guard must prevent horizontal document overflow');
assert.match(mobile, /-webkit-text-size-adjust:100%/, 'mobile guard must normalize iOS text scaling');
assert.match(mobile, /pointer:\s*coarse/, 'mobile guard must distinguish touch/mobile scanners');
assert.match(mobile, /restaurantVisitCode/, 'mobile guard must detect visit code input');
assert.match(mobile, /input\.blur\(\)/, 'mobile guard must avoid forced keyboard on first QR paint');
assert.match(visit, /input\?\.focus\(\{ preventScroll:true \}\)/, 'test must cover current visit overlay autofocus behavior');

assert.match(edgeFallback, /CONTINUAR EN RED LOCAL/, 'Edge fallback must expose an explicit LAN continuation instead of a silent redirect');
assert.match(edgeFallback, /url\.protocol !== 'http:'/, 'LAN fallback must reject non-local protocol shapes before navigation');
assert.doesNotMatch(edgeFallback, /setInterval|MutationObserver/, 'Edge fallback must not add polling or DOM observers');
assert.doesNotMatch(tracking, /setInterval|MutationObserver/, 'Order tracking must not add browser intervals or DOM observers');

assert.match(routes, /const \[mobileFit, edgeFallback, visitUi, trackingUi, baseUi\] = await Promise\.all/, 'QR compositor must load mobile guard, Edge fallback, visit, tracking and base engines');
assert.match(routes, /send\(`\$\{mobileFit\}\\n;\$\{edgeFallback\}\\n;\$\{visitUi\}\\n;\$\{trackingUi\}\\n;\$\{baseUi\}`\)/, 'combined QR asset must execute mobile fit first, then Edge fallback, visit, tracking and base UI');

console.log('RESTAURANT QR MOBILE FIT + TRACKING SMOKE OK');
