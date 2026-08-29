'use strict';

function cleanText(value, max = 180) {
  return String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function normalizedKey(value) {
  return cleanText(value, 220).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}
function parsePriceToken(value) {
  let raw = String(value || '').toUpperCase().replace(/COP|PESOS?/g, '').replace(/\$/g, '').replace(/\s+/g, '').trim();
  if (!raw) return 0;
  const kilo = raw.endsWith('K');
  if (kilo) raw = raw.slice(0, -1);
  if (kilo) { const n = Number(raw.replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : 0; }
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw) || (raw.includes('.') && raw.includes(',')) || /^\d+[.,]\d{3}$/.test(raw)) raw = raw.replace(/[.,]/g, '');
  else raw = raw.replace(',', '.');
  const n = Number(raw); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
function inferOperationalCategory(category, product) {
  const value = `${normalizedKey(category)} ${normalizedKey(product)}`;
  if (/(BEBIDA|JUGO|GASEOSA|SODA|AGUA|CAFE|CERVEZA|VINO|COCTEL|LIMONADA|MALTEADA|\bTE\b|CHOCOLATE)/.test(value)) return 'BEBIDAS';
  if (/(POSTRE|HELADO|TORTA|PASTEL|BROWNIE|FLAN|TIRAMISU|DULCE|WAFFLE)/.test(value)) return 'POSTRES';
  if (/(ENTRADA|PICADA|NACHO|EMPANADA|AREPA|PAN DE AJO|ALITA|PATACON)/.test(value)) return 'ENTRADAS';
  return 'FUERTES';
}
function stationFor(category) { return category === 'BEBIDAS' ? 'BARRA' : category === 'POSTRES' ? 'POSTRES' : 'COCINA'; }

const HEADINGS = new Map([
  ['HAMBURGUESAS','Hamburguesas'],['HAMBURGUESA','Hamburguesas'],['PERROS','Perros'],['PERROS CALIENTES','Perros'],['PIZZAS','Pizzas'],['PIZZA','Pizzas'],
  ['SALCHIPAPAS','Salchipapas'],['SALCHIPAPA','Salchipapas'],['PAPAS','Papas'],['TORNADOS','Tornados'],['TORNADO','Tornados'],['CHUZOS','Chuzos'],['CHUZO','Chuzos'],['BROCHETAS','Chuzos'],
  ['ALITAS','Alitas'],['ALITA','Alitas'],['PATACONES','Patacones'],['MAICITOS','Maicitos'],['ENTRADAS','Entradas'],['BEBIDAS','Bebidas'],['JUGOS','Jugos'],['JUGOS NATURALES','Jugos'],
  ['GASEOSAS','Gaseosas'],['CERVEZAS','Cervezas'],['COCTELES','Cócteles'],['CAFES','Cafés'],['POSTRES','Postres'],['HELADOS','Helados'],['DESAYUNOS','Desayunos'],['ALMUERZOS','Almuerzos'],
  ['PASTAS','Pastas'],['ARROCES','Arroces'],['CARNES','Carnes'],['POLLO','Pollo'],['PESCADOS','Pescados'],['ENSALADAS','Ensaladas'],['SOPAS','Sopas'],['PICADAS','Picadas'],
  ['COMBOS','Combos'],['AREPAS','Arepas'],['EMPANADAS','Empanadas'],['SANDWICHES','Sándwiches'],['SANDWICH','Sándwiches']
]);
const FAMILY_RULES = [
  [/\bCOMBO\b/,'Combos'],[/\bSALCHIPAPAS?\b/,'Salchipapas'],[/\bHAMBURGUESAS?\b/,'Hamburguesas'],[/\bPERROS?(?: CALIENTES?)?\b/,'Perros'],[/\bPIZZAS?\b/,'Pizzas'],
  [/\bTORNADOS?\b/,'Tornados'],[/\bCHUZOS?\b|\bBROCHETAS?\b/,'Chuzos'],[/\bPAPAS?\b/,'Papas'],[/\bALITAS?\b/,'Alitas'],[/\bPATACONES?\b/,'Patacones'],[/\bMAICITOS?\b/,'Maicitos'],
  [/\bJUGOS?\b|\bLIMONADAS?\b|\bGASEOSAS?\b|\bCERVEZAS?\b|\bMALTEADAS?\b|\bBEBIDAS?\b|\bAGUA\b|\bCAFE\b|\bCOCTELES?\b/,'Bebidas'],
  [/\bPOSTRES?\b|\bHELADOS?\b|\bBROWNIE\b|\bTORTAS?\b|\bFLAN\b|\bWAFFLES?\b/,'Postres'],[/\bENTRADAS?\b|\bNACHOS?\b|\bEMPANADAS?\b|\bAREPAS?\b/,'Entradas']
];
function categoryHeading(line) {
  const value = cleanText(line, 80).replace(/^[•·*\-–—]+\s*/, '').replace(/[:.]+$/, '').trim();
  const normalized = normalizedKey(value); if (HEADINGS.has(normalized)) return HEADINGS.get(normalized);
  const letters = value.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, ''), uppers = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '');
  return letters.length >= 4 && value.length <= 45 && value.split(/\s+/).length <= 5 && uppers.length / letters.length >= .88 ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : null;
}
function looksLikeNoise(line) { return /(WHATSAPP|INSTAGRAM|FACEBOOK|DIRECCION|DOMICILIO|RESERVAS|TELEFONO|CELULAR|HORARIO|NIT\b|SIGUENOS|VISITANOS|WWW\b|@)/.test(normalizedKey(line)); }
function normalizeProductText(value) {
  return cleanText(value, 180).replace(/^[\s¡¿•·*\-–—|:;,.>_=+~]+/, '').replace(/[._·•]{2,}/g, ' ').replace(/\s+[|:;\-–—]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}
function familyCategory(product) { const value = normalizedKey(product); for (const [pattern, category] of FAMILY_RULES) if (pattern.test(value)) return category; return null; }
function extractUppercaseTitle(value) {
  const words = normalizeProductText(value).split(/\s+/).filter(Boolean).slice(0, 12); if (words.length < 2) return '';
  const title = [];
  for (const word of words) {
    const letters = word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-zÑñ]/g, '');
    if (!letters) { if (title.length) break; continue; }
    if (letters === letters.toUpperCase()) title.push(word); else if (title.length >= 2) break; else return '';
  }
  while (title.length >= 3) { const first = normalizedKey(title[0]); if (first.length <= 2 && !['TE','XL'].includes(first)) title.shift(); else break; }
  const out = normalizeProductText(title.join(' ')); return title.length >= 2 && out.length >= 4 && out.length <= 80 ? out : '';
}
function productCandidate(value) {
  const raw = String(value || '').trim(); if (!raw) return '';
  const strong = raw.split(/(?:\s*(?:->|→|—{1,}|–{1,}|={2,}|-{3,}|\|)\s*|\.{3,})/)[0] || raw;
  let cleaned = normalizeProductText(strong).replace(/^[A-Za-z0-9]{1,2}\s*[-:)>]+\s*/, '');
  const uppercase = extractUppercaseTitle(cleaned); cleaned = normalizeProductText(uppercase || cleaned);
  return cleaned.replace(/\s+(?:con|incluye|acompañado|acompanado)$/i, '').trim();
}
function candidateScore(value) {
  const text = normalizeProductText(value); if (!text || looksLikeNoise(text)) return -1000;
  const words = text.split(/\s+/).filter(Boolean), letters = text.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, ''); if (!letters) return -1000;
  const upperRatio = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length / letters.length; let score = 0;
  score += text.length >= 4 && text.length <= 58 ? 28 : text.length <= 82 ? 10 : -25;
  score += words.length >= 1 && words.length <= 6 ? 24 : words.length > 10 ? -30 : 0;
  if (upperRatio >= .72 && words.length >= 2) score += 24; if (familyCategory(text)) score += 24;
  if (/^(CON|ACOMPANADO|INCLUYE|SERVIDO|PREPARADO|TIENE|LLEVA)\b/i.test(text)) score -= 45;
  score -= (text.match(/[{}<>_=~^`\\]/g) || []).length * 6; return score;
}
function chooseProductCandidate(beforePrice, pendingLines) {
  const candidates = [productCandidate(beforePrice), ...pendingLines.slice().reverse().map(productCandidate)].filter(Boolean); let best = '', bestScore = -Infinity;
  for (const candidate of candidates) { const score = candidateScore(candidate); if (score > bestScore) { best = candidate; bestScore = score; } }
  return bestScore >= 0 ? best : '';
}
function fallbackCommercialCategory(op) { return op === 'BEBIDAS' ? 'Bebidas' : op === 'POSTRES' ? 'Postres' : op === 'ENTRADAS' ? 'Entradas' : 'Platos'; }
function priceMatches(line) {
  const re = /(?:COP\s*)?\$?\s*(?:\d{1,3}(?:[.,]\d{3})+|\d{4,9}|\d{1,3}(?:[.,]\d{1,2})?\s*[Kk])(?:\s*(?:COP|PESOS?))?/gi, out = []; let match;
  while ((match = re.exec(line)) !== null) { const p = parsePriceToken(match[0]); if (p > 0) out.push({ price:p, index:match.index, end:match.index + match[0].length }); if (match.index === re.lastIndex) re.lastIndex += 1; }
  return out;
}
function parseMenuText(text, options = {}) {
  const lines = String(text || '').replace(/\r/g, '\n').split(/\n+/).map((line) => line.replace(/[\t]+/g, ' ').trim()).filter(Boolean);
  let currentCategory = 'Otros', pendingLines = []; const rows = [], seen = new Set();
  const baseConfidence = Number.isFinite(Number(options.baseConfidence)) ? Number(options.baseConfidence) : null;
  for (const rawLine of lines) {
    const line = cleanText(rawLine, 320); if (looksLikeNoise(line)) continue; const prices = priceMatches(line);
    if (!prices.length) { const heading = categoryHeading(line); if (heading) { currentCategory = heading; pendingLines = []; } else if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(line) && line.length <= 100) { pendingLines.push(line); if (pendingLines.length > 4) pendingLines.shift(); } continue; }
    const product = chooseProductCandidate(line.slice(0, prices[0].index), pendingLines); pendingLines = []; if (!product) continue;
    const family = familyCategory(product), op = inferOperationalCategory(family || currentCategory, product), commercial = family || (currentCategory !== 'Otros' ? currentCategory : fallbackCommercialCategory(op));
    const dedupe = `${normalizedKey(commercial)}|${normalizedKey(product)}|${prices[0].price}`; if (seen.has(dedupe)) continue; seen.add(dedupe);
    let confidence = baseConfidence ?? (currentCategory === 'Otros' ? .68 : .84); if (family) confidence += .05; if (candidateScore(product) < 35) confidence -= .12;
    rows.push({ category:cleanText(commercial, 80), subcategory:product, price:prices[0].price, operationalCategory:op, station:stationFor(op), confidence:Math.max(.45, Math.min(.98, confidence)) });
    if (rows.length >= 300) break;
  }
  return rows;
}
function menuOcrScore(text) {
  const source = String(text || ''); if (!source.trim()) return -100000; const rows = parseMenuText(source), lines = source.split(/\r?\n/).map((x) => cleanText(x, 320)).filter(Boolean);
  const categories = new Set(rows.map((row) => normalizedKey(row.category))); let score = rows.length * 140 + categories.size * 24;
  for (const line of lines) { if (priceMatches(line).length) score += 18; if (categoryHeading(line)) score += 12; score -= (line.match(/[{}<>_=~^`\\]/g) || []).length * 4; }
  score += Math.min(120, (source.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length / 12); score -= (source.match(/[�]/g) || []).length * 25; return score;
}

module.exports = { cleanText, normalizedKey, parsePriceToken, parseMenuText, menuOcrScore, familyCategory, productCandidate, candidateScore, inferOperationalCategory, stationFor };
