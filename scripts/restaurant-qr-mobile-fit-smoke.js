'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('src/web/restaurant-qr.html', 'utf8');
const mobile = fs.readFileSync('src/web/restaurant-qr-mobile-fit.js', 'utf8');
const visit = fs.readFileSync('src/web/restaurant-qr-visit-ui.js', 'utf8');
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

assert.match(routes, /const \[mobileFit, visitUi, baseUi\] = await Promise\.all/, 'QR compositor must load mobile guard with visit and base engines');
assert.match(routes, /send\(`\$\{mobileFit\}\\n;\$\{visitUi\}\\n;\$\{baseUi\}`\)/, 'combined QR asset must execute mobile fit before visit and base UI');

console.log('RESTAURANT QR MOBILE FIT SMOKE OK');
