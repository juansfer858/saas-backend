const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('design/super-core-sidebar-preview-v1.html', 'utf8');

assert.match(html, /BOCETO VISUAL V1 · SIN DATOS REALES/);
assert.match(html, /--side:#171c1a/);
assert.match(html, /--green:#16845a/);
assert.match(html, /Restaurante Demo Core/);
assert.match(html, /Inventarios \/ Kardex/);
assert.match(html, /Tesorería & Bancos/);
assert.match(html, /Configuración avanzada/);
assert.match(html, /stroke-width:1\.7/);
assert.ok((html.match(/<svg /g) || []).length >= 12, 'Preview must use a consistent inline SVG icon system');
assert.ok(!/fetch\s*\(/.test(html), 'Design preview must not call APIs');
assert.ok(!/XMLHttpRequest|WebSocket|EventSource/.test(html), 'Design preview must remain isolated from runtime data');
assert.ok(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(html), 'Design preview must not contain write calls');

console.log('SUPER CORE SIDEBAR ISOLATED VISUAL PREVIEW V1 SMOKE OK');
