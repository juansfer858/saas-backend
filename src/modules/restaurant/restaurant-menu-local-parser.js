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
  if (/(BEBIDA|JUGO|GASEOSA|SODA|AGUA|CAFE|CERVEZA|VINO|COCTEL|LIMONADA|MALTEADA|TE |CHOCOLATE)/.test(value)) return 'BEBIDAS';
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
  ['ENTRADAS', 'Entradas'], ['BEBIDAS', 'Bebidas'], ['JUGOS', 'Jugos'],
  ['JUGOS NATURALES', 'Jugos'], ['GASEOSAS', 'Gaseosas'], ['CERVEZAS', 'Cervezas'],
  ['COCTELES', 'Cócteles'], ['CAFES', 'Cafés'], ['POSTRES', 'Postres'], ['HELADOS', 'Helados'],
  ['DESAYUNOS', 'Desayunos'], ['ALMUERZOS', 'Almuerzos'], ['PASTAS', 'Pastas'], ['ARROCES', 'Arroces'],
  ['CARNES', 'Carnes'], ['POLLO', 'Pollo'], ['PESCADOS', 'Pescados'], ['ENSALADAS', 'Ensaladas'],
  ['SOPAS', 'Sopas'], ['PICADAS', 'Picadas'], ['COMBOS', 'Combos'], ['AREPAS', 'Arepas'],
  ['EMPANADAS', 'Empanadas'], ['SANDWICHES', 'Sándwiches']
]);

const INLINE_PREFIXES = [
  ['HAMBURGUESAS', 'Hamburguesas'], ['PERROS CALIENTES', 'Perros'], ['PERROS', 'Perros'],
  ['PIZZAS', 'Pizzas'], ['JUGOS', 'Jugos'], ['CERVEZAS', 'Cervezas'], ['POSTRES', 'Postres'],
  ['HELADOS', 'Helados'], ['ENTRADAS', 'Entradas'], ['COMBOS', 'Combos']
];

function categoryHeading(line) {
  const value = cleanText(line, 80).replace(/^[•·*\-–—]+\s*/, '').replace(/[:.]+$/, '').trim();
  const normalized = normalizedKey(value);
  if (HEADINGS.has(normalized)) return HEADINGS.get(normalized);
  const letters = value.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  const uppers = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '');
  if (letters.length >= 4 && value.length <= 45 && value.split(/\s+/).length <= 5 && uppers.length / letters.length >= 0.86) {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
  return null;
}

function stripInlineCategory(product, currentCategory) {
  const value = cleanText(product, 180);
  const normalized = normalizedKey(value);
  for (const [prefix, category] of INLINE_PREFIXES) {
    if (normalized.startsWith(`${prefix} `)) {
      const words = prefix.split(' ').length;
      const rest = value.split(/\s+/).slice(words).join(' ').trim();
      if (rest.length >= 2) return { category, product: rest };
    }
  }
  return { category: currentCategory, product: value };
}

function looksLikeNoise(line) {
  const value = normalizedKey(line);
  if (!value) return true;
  return /(WHATSAPP|INSTAGRAM|FACEBOOK|DIRECCION|DOMICILIO|RESERVAS|TELEFONO|CELULAR|HORARIO|NIT\b|SIGUENOS|VISITANOS)/.test(value);
}

function looksLikeDescription(line) {
  const value = normalizedKey(line);
  return line.length > 75 || /^(CON|ACOMPANADO|INCLUYE|SERVIDO|PREPARADO|TIENE|LLEVA)\b/.test(value);
}

function normalizeProductText(value) {
  return cleanText(value, 180)
    .replace(/^[•·*\-–—]+\s*/, '')
    .replace(/[._·•]{2,}/g, ' ')
    .replace(/\s+[|:;\-–—]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
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

function parseMenuText(text) {
  const lines = String(text || '').replace(/\r/g, '\n').replace(/[\t]+/g, ' ').split(/\n+/).map((line) => cleanText(line, 260)).filter(Boolean);
  let currentCategory = 'Otros';
  let pendingName = '';
  const rows = [];
  const seen = new Set();

  const pushRow = (category, product, price, confidence) => {
    let name = normalizeProductText(product);
    if (!name || name.length < 2 || looksLikeNoise(name)) return;
    const inline = stripInlineCategory(name, category);
    name = normalizeProductText(inline.product);
    let commercialCategory = inline.category || category || 'Otros';
    const operationalCategory = inferOperationalCategory(commercialCategory, name);
    if (!commercialCategory || commercialCategory === 'Otros') commercialCategory = fallbackCommercialCategory(operationalCategory);
    const key = `${normalizedKey(commercialCategory)}|${normalizedKey(name)}|${price}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ category: cleanText(commercialCategory, 80), subcategory: name, price, operationalCategory, station: stationFor(operationalCategory), confidence });
  };

  for (const line of lines) {
    if (looksLikeNoise(line)) continue;
    const prices = priceMatches(line);
    if (!prices.length) {
      const heading = categoryHeading(line);
      if (heading) {
        currentCategory = heading;
        pendingName = '';
      } else if (!looksLikeDescription(line) && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(line) && line.length <= 75) {
        pendingName = normalizeProductText(line);
      }
      continue;
    }

    let product = normalizeProductText(line.slice(0, prices[0].index));
    if (!product) product = pendingName;
    if (!product) continue;
    pushRow(currentCategory, product, prices[0].price, currentCategory === 'Otros' ? 0.72 : 0.86);
    pendingName = '';
    if (rows.length >= 300) break;
  }
  return rows.slice(0, 300);
}

module.exports = { cleanText, normalizedKey, parsePriceToken, parseMenuText, inferOperationalCategory, stationFor };
