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
  if (kilo) {
    const decimal = Number(raw.replace(',', '.'));
    return Number.isFinite(decimal) && decimal > 0 ? Math.round(decimal * 1000) : 0;
  }
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, '');
  else if (raw.includes('.') && raw.includes(',')) raw = raw.replace(/[.,]/g, '');
  else if (/^\d+[.,]\d{3}$/.test(raw)) raw = raw.replace(/[.,]/g, '');
  else raw = raw.replace(',', '.');
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

function inferOperationalCategory(category, product) {
  const value = `${normalizedKey(category)} ${normalizedKey(product)}`;
  if (/(BEBIDA|JUGO|GASEOSA|SODA|AGUA|CAFE|CERVEZA|VINO|COCTEL|LIMONADA|MALTEADA|\bTE\b|CHOCOLATE)/.test(value)) return 'BEBIDAS';
  if (/(POSTRE|HELADO|TORTA|PASTEL|BROWNIE|FLAN|TIRAMISU|DULCE|WAFFLE)/.test(value)) return 'POSTRES';
  if (/(ENTRADA|PICADA|NACHO|EMPANADA|AREPA|PAN DE AJO|ALITA|PATACON)/.test(value)) return 'ENTRADAS';
  return 'FUERTES';
}

function stationFor(category) {
  if (category === 'BEBIDAS') return 'BARRA';
  if (category === 'POSTRES') return 'POSTRES';
  return 'COCINA';
}

const HEADINGS = new Map([
  ['HAMBURGUESAS', 'Hamburguesas'], ['HAMBURGUESA', 'Hamburguesas'],
  ['PERROS', 'Perros'], ['PERROS CALIENTES', 'Perros'],
  ['PIZZAS', 'Pizzas'], ['PIZZA', 'Pizzas'],
  ['SALCHIPAPAS', 'Salchipapas'], ['SALCHIPAPA', 'Salchipapas'],
  ['PAPAS', 'Papas'], ['TORNADOS', 'Tornados'], ['TORNADO', 'Tornados'],
  ['CHUZOS', 'Chuzos'], ['CHUZO', 'Chuzos'], ['BROCHETAS', 'Chuzos'],
  ['ALITAS', 'Alitas'], ['ALITA', 'Alitas'], ['PATACONES', 'Patacones'], ['MAICITOS', 'Maicitos'],
  ['ENTRADAS', 'Entradas'], ['BEBIDAS', 'Bebidas'], ['JUGOS', 'Jugos'],
  ['JUGOS NATURALES', 'Jugos'], ['GASEOSAS', 'Gaseosas'], ['CERVEZAS', 'Cervezas'],
  ['COCTELES', 'Cócteles'], ['CAFES', 'Cafés'], ['POSTRES', 'Postres'], ['HELADOS', 'Helados'],
  ['DESAYUNOS', 'Desayunos'], ['ALMUERZOS', 'Almuerzos'], ['PASTAS', 'Pastas'], ['ARROCES', 'Arroces'],
  ['CARNES', 'Carnes'], ['POLLO', 'Pollo'], ['PESCADOS', 'Pescados'], ['ENSALADAS', 'Ensaladas'],
  ['SOPAS', 'Sopas'], ['PICADAS', 'Picadas'], ['COMBOS', 'Combos'], ['AREPAS', 'Arepas'],
  ['EMPANADAS', 'Empanadas'], ['SANDWICHES', 'Sándwiches'], ['SANDWICH', 'Sándwiches']
]);

const FAMILY_RULES = [
  [/\bCOMBO\b/, 'Combos'],
  [/\bSALCHIPAPAS?\b/, 'Salchipapas'],
  [/\bHAMBURGUESAS?\b/, 'Hamburguesas'],
  [/\bPERROS?(?: CALIENTES?)?\b/, 'Perros'],
  [/\bPIZZAS?\b/, 'Pizzas'],
  [/\bTORNADOS?\b/, 'Tornados'],
  [/\bCHUZOS?\b|\bBROCHETAS?\b/, 'Chuzos'],
  [/\bPAPAS?\b/, 'Papas'],
  [/\bALITAS?\b/, 'Alitas'],
  [/\bPATACONES?\b/, 'Patacones'],
  [/\bMAICITOS?\b/, 'Maicitos'],
  [/\bJUGOS?\b|\bLIMONADAS?\b|\bGASEOSAS?\b|\bCERVEZAS?\b|\bMALTEADAS?\b|\bBEBIDAS?\b|\bAGUA\b|\bCAFE\b|\bCOCTELES?\b/, 'Bebidas'],
  [/\bPOSTRES?\b|\bHELADOS?\b|\bBROWNIE\b|\bTORTAS?\b|\bFLAN\b|\bWAFFLES?\b/, 'Postres'],
  [/\bENTRADAS?\b|\bNACHOS?\b|\bEMPANADAS?\b|\bAREPAS?\b/, 'Entradas']
];

function categoryHeading(line) {
  const value = cleanText(line, 80).replace(/^[•·*\-–—]+\s*/, '').replace(/[:.]+$/, '').trim();
  const normalized = normalizedKey(value);
  if (HEADINGS.has(normalized)) return HEADINGS.get(normalized);
  const letters = value.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  const uppers = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '');
  if (letters.length >= 4 && value.length <= 45 && value.split(/\s+/).length <= 5 && uppers.length / letters.length >= 0.88) {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
  return null;
}

function looksLikeNoise(line) {
  const value = normalizedKey(line);
  if (!value) return true;
  return /(WHATSAPP|INSTAGRAM|FACEBOOK|DIRECCION|DOMICILIO|RESERVAS|TELEFONO|CELULAR|HORARIO|NIT\b|SIGUENOS|VISITANOS|WWW\b|@)/.test(value);
}

function looksLikeDescription(line) {
  const value = normalizedKey(line);
  return line.length > 92 || /^(CON|ACOMPANADO|INCLUYE|SERVIDO|PREPARADO|TIENE|LLEVA|PAN |CARNE |POLLO |QUESO |SALSA )\b/.test(value);
}

function normalizeProductText(value) {
  return cleanText(value, 180)
    .replace(/^[\s•·*\-–—|:;,.>_=+~]+/, '')
    .replace(/[._·•]{2,}/g, ' ')
    .replace(/\s+[|:;\-–—]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function familyCategory(product) {
  const value = normalizedKey(product);
  for (const [pattern, category] of FAMILY_RULES) if (pattern.test(value)) return category;
  return null;
}

function extractUppercaseTitle(value) {
  const cleaned = normalizeProductText(value);
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 12);
  if (words.length < 2) return '';
  const connectors = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'CON', 'Y', 'AL', 'A']);
  const title = [];
  for (const word of words) {
    const letters = word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-zÑñ]/g, '');
    if (!letters) {
      if (title.length) break;
      continue;
    }
    const upper = letters === letters.toUpperCase();
    if (upper || (title.length && connectors.has(letters.toUpperCase()))) title.push(word);
    else if (title.length >= 2) break;
    else return '';
  }
  while (title.length >= 3) {
    const first = normalizedKey(title[0]);
    if (first.length <= 2 && !['TE', 'XL'].includes(first)) title.shift();
    else break;
  }
  const out = normalizeProductText(title.join(' '));
  return title.length >= 2 && out.length >= 4 && out.length <= 80 ? out : '';
}

function productCandidate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const strong = raw.split(/(?:\s*(?:->|→|—{1,}|–{1,}|={2,}|-{3,}|\|)\s*|\.{3,})/)[0] || raw;
  const cleaned = normalizeProductText(strong);
  const uppercase = extractUppercaseTitle(cleaned);
  return normalizeProductText(uppercase || cleaned);
}

function candidateScore(value) {
  const text = normalizeProductText(value);
  if (!text || looksLikeNoise(text)) return -1000;
  const words = text.split(/\s+/).filter(Boolean);
  const letters = text.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (!letters) return -1000;
  const uppers = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '');
  const upperRatio = uppers.length / letters.length;
  let score = 0;
  if (text.length >= 4 && text.length <= 58) score += 28;
  else if (text.length <= 82) score += 10;
  else score -= 25;
  if (words.length >= 1 && words.length <= 6) score += 24;
  else if (words.length > 10) score -= 30;
  if (upperRatio >= 0.72 && words.length >= 2) score += 24;
  if (familyCategory(text)) score += 24;
  if (/^(CON|ACOMPANADO|INCLUYE|SERVIDO|PREPARADO|TIENE|LLEVA)\b/i.test(text)) score -= 45;
  score -= (text.match(/[{}<>_=~^`\\]/g) || []).length * 6;
  return score;
}

function chooseProductCandidate(beforePrice, pendingLines) {
  const candidates = [productCandidate(beforePrice), ...pendingLines.slice().reverse().map(productCandidate)].filter(Boolean);
  let best = '';
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = candidateScore(candidate);
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  return bestScore >= 0 ? best : '';
}

function fallbackCommercialCategory(operationalCategory) {
  if (operationalCategory === 'BEBIDAS') return 'Bebidas';
  if (operationalCategory === 'POSTRES') return 'Postres';
  if (operationalCategory === 'ENTRADAS') return 'Entradas';
  return 'Platos';
}

function priceMatches(line) {
  const regex = /(?:COP\s*)?\$?\s*(?:\d{1,3}(?:[.,]\d{3})+|\d{4,9}|\d{1,3}(?:[.,]\d{1,2})?\s*[Kk])(?:\s*(?:COP|PESOS?))?/gi;
  const matches = [];
  let match;
  while ((match = regex.exec(line)) !== null) {
    const price = parsePriceToken(match[0]);
    if (price > 0) matches.push({ price, index: match.index, end: match.index + match[0].length });
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
  return matches;
}

function parseMenuText(text, options = {}) {
  const lines = String(text || '').replace(/\r/g, '\n').split(/\n+/).map((line) => line.replace(/[\t]+/g, ' ').trim()).filter(Boolean);
  let currentCategory = 'Otros';
  let pendingLines = [];
  const rows = [];
  const seen = new Set();
  const baseConfidence = Number.isFinite(Number(options.baseConfidence)) ? Number(options.baseConfidence) : null;

  const pushRow = (category, product, price, confidence) => {
    const name = normalizeProductText(product);
    if (!name || name.length < 2 || looksLikeNoise(name)) return;
    const family = familyCategory(name);
    let commercialCategory = family || category || 'Otros';
    const operationalCategory = inferOperationalCategory(commercialCategory, name);
    if (!commercialCategory || commercialCategory === 'Otros') commercialCategory = fallbackCommercialCategory(operationalCategory);
    const dedupe = `${normalizedKey(commercialCategory)}|${normalizedKey(name)}|${price}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    const q = Math.max(0.45, Math.min(0.98, baseConfidence ?? confidence));
    rows.push({ category: cleanText(commercialCategory, 80), subcategory: name, price, operationalCategory, station: stationFor(operationalCategory), confidence: q });
  };

  for (const rawLine of lines) {
    const line = cleanText(rawLine, 320);
    if (looksLikeNoise(line)) continue;
    const prices = priceMatches(line);
    if (!prices.length) {
      const heading = categoryHeading(line);
      if (heading) {
        currentCategory = heading;
        pendingLines = [];
      } else if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(line) && line.length <= 100) {
        pendingLines.push(line);
        if (pendingLines.length > 4) pendingLines.shift();
      }
      continue;
    }

    const beforePrice = rawLine.slice(0, prices[0].index);
    const product = chooseProductCandidate(beforePrice, pendingLines);
    if (!product) { pendingLines = []; continue; }
    const quality = candidateScore(product);
    let confidence = currentCategory === 'Otros' ? 0.68 : 0.84;
    if (familyCategory(product)) confidence += 0.06;
    if (quality < 35) confidence -= 0.12;
    pushRow(currentCategory, product, prices[0].price, confidence);
    pendingLines = [];
    if (rows.length >= 300) break;
  }
  return rows.slice(0, 300);
}

function menuOcrScore(text) {
  const source = String(text || '');
  if (!source.trim()) return -100000;
  const rows = parseMenuText(source);
  const lines = source.split(/\r?\n/).map((x) => cleanText(x, 320)).filter(Boolean);
  const categories = new Set(rows.map((row) => normalizedKey(row.category)));
  let score = rows.length * 140 + categories.size * 24;
  for (const line of lines) {
    if (priceMatches(line).length) score += 18;
    if (categoryHeading(line)) score += 12;
    score -= (line.match(/[{}<>_=~^`\\]/g) || []).length * 4;
  }
  const alpha = (source.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
  const garbage = (source.match(/[�]/g) || []).length;
  score += Math.min(120, alpha / 12);
  score -= garbage * 25;
  return score;
}

module.exports = {
  cleanText,
  normalizedKey,
  parsePriceToken,
  parseMenuText,
  menuOcrScore,
  familyCategory,
  productCandidate,
  candidateScore,
  inferOperationalCategory,
  stationFor
};
