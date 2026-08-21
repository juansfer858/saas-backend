const assert = require('node:assert/strict');
const fs = require('node:fs');
const text = fs.readFileSync('docs/RESTAURANT_IDENTITY_ACCEPTANCE_MATRIX_V1.md','utf8');
for (const token of ['Cinco pantallas con datos reales','Mesero → KDS sin recargar','QR marcado como QR','Tema único para 5 pantallas','Mesero sin KDS/Caja','Diferencia de caja real']) assert.ok(text.includes(token));
console.log('RESTAURANT IDENTITY ACCEPTANCE DOC SMOKE OK');
