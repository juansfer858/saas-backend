const assert = require('node:assert/strict');
const fs = require('node:fs');
const note = fs.readFileSync('docs/RESTAURANT_IDENTITY_SOURCE_NOTE.md','utf8');
assert.match(note, /restaurante_identidad_v1\.html/);
assert.match(note, /no declara que los valores hexadecimales reconstruidos sean una copia byte-a-byte/);
assert.match(note, /no se cambia ninguna consulta, endpoint, RBAC, pedido, comanda, QR ni cierre de caja/);
console.log('RESTAURANT IDENTITY SOURCE NOTE SMOKE OK');
