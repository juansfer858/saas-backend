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
assert.doesNotMatch(html, /user-scalable\s*=\s*no/i, 'QR HTML must not disable user pinch zoom');

assert.match(mobile, /RESTAURANT_QR_MOBILE_COMPACT_V29/, 'mobile guard must expose compact V29 marker');
assert.match(mobile, /minimum-scale=1/, 'mobile guard must normalize initial viewport scale');
assert.match(mobile, /100dvw/, 'mobile guard must cap layout to dynamic device width');
assert.match(mobile, /100dvh/, 'mobile guard must use dynamic viewport height');
assert.match(mobile, /overflow-x:(hidden|clip)/, 'mobile guard must prevent horizontal document overflow');
assert.match(mobile, /-webkit-text-size-adjust:100%/, 'mobile guard must normalize iOS text scaling');
assert.match(mobile, /touch-action:manipulation/, 'touch controls must prevent browser double-tap zoom without disabling pinch zoom');
assert.match(mobile, /font-size:16px!important/, 'focusable mobile fields must stay at 16px to prevent iOS input zoom');
assert.match(mobile, /window\.visualViewport/, 'mobile guard must follow the actual visual viewport when the keyboard opens');
assert.match(mobile, /--qrv-visible-height/, 'keyboard-safe visible height must be exposed to CSS');
assert.match(mobile, /--qrv-visible-top/, 'keyboard-safe visual viewport top offset must be exposed to CSS');
assert.match(mobile, /max-height:calc\(var\(--qrv-visible-height,100dvh\) - 6px\)/, 'mobile sheets must fit inside the keyboard-reduced viewport');
assert.match(mobile, /\.qrv3-menu-row\{[^}]*padding:9px 8px!important/, 'mobile product rows must use compact density');
assert.match(mobile, /\.qrv3-stepper\{[^}]*min-height:40px!important/, 'mobile quantity controls must be compact while remaining touchable');
assert.match(mobile, /\.qrv3-cartbar\{[^}]*padding:5px 6px!important/, 'mobile fixed cart bar must use compact density');
assert.match(mobile, /\.qrv3-send\{[^}]*min-height:46px!important/, 'send action must be compact but keep a safe touch target');
assert.match(mobile, /pointer:\s*coarse/, 'mobile guard must distinguish touch/mobile scanners');
assert.match(mobile, /restaurantVisitCode/, 'mobile guard must detect visit code input');
assert.match(mobile, /input\.blur\(\)/, 'mobile guard must avoid forced keyboard on first QR paint');
assert.match(mobile, /qrvInitialFocusSettled/, 'initial keyboard suppression must happen only once per rendered code field');
assert.match(mobile, /scrollIntoView\(\{ block:'center'/, 'focused modal fields must stay visible above the keyboard');
assert.match(visit, /input\?\.focus\(\{ preventScroll:true \}\)/, 'test must cover current visit overlay autofocus behavior');

assert.match(edgeFallback, /CONTINUAR EN RED LOCAL/, 'Edge fallback must expose an explicit LAN continuation instead of a silent redirect');
assert.match(edgeFallback, /url\.protocol !== 'http:'/, 'LAN fallback must reject non-local protocol shapes before navigation');
assert.doesNotMatch(edgeFallback, /setInterval|MutationObserver/, 'Edge fallback must not add polling or DOM observers');
assert.doesNotMatch(tracking, /setInterval|MutationObserver/, 'Order tracking must not add browser intervals or DOM observers');

assert.match(routes, /const \[mobileFit, edgeFallback, visitUi, trackingUi, baseUi\] = await Promise\.all/, 'QR compositor must load mobile guard, Edge fallback, visit, tracking and base engines');
assert.match(routes, /send\(`\$\{mobileFit\}\\n;\$\{edgeFallback\}\\n;\$\{visitUi\}\\n;\$\{trackingUi\}\\n;\$\{baseUi\}`\)/, 'combined QR asset must execute mobile fit first, then Edge fallback, visit, tracking and base UI');

new Function(mobile);
console.log('RESTAURANT QR MOBILE COMPACT V29 + KEYBOARD FIT + NO AUTO ZOOM SMOKE OK');
