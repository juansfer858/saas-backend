((root, factory) => {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VantixGCRestaurantOcrStrictV4 = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';
  const MARKER = 'VANTIX_MENU_OCR_STRICT_V4';
  const FAMILY = /(COMBO|SALCHIPAPAS?|HAMBURGUESAS?|PERROS?|PIZZAS?|TORNADOS?|CHUZOS?|BROCHETAS?|PAPAS?|ALITAS?|PATACONES?|MAICITOS?|JUGOS?|LIMONADAS?|GASEOSAS?|CERVEZAS?|MALTEADAS?|BEBIDAS?|POSTRES?|HELADOS?|AREPAS?|SANDWICHES?)/;
  const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const key = (v) => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

  function editDistance(a, b) {
    const x = key(a), y = key(b);
    if (x === y) return 0;
    if (!x) return y.length;
    if (!y) return x.length;
    const prev = Array.from({ length:y.length + 1 }, (_, i) => i);
    for (let i = 1; i <= x.length; i += 1) {
      const next = [i];
      for (let j = 1; j <= y.length; j += 1) {
        next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      }
      for (let j = 0; j < next.length; j += 1) prev[j] = next[j];
    }
    return prev[y.length];
  }

  function similarity(a, b) {
    const x = key(a), y = key(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const max = Math.max(x.length, y.length);
    return max ? 1 - editDistance(x, y) / max : 0;
  }

  function plausibleName(name) {
    const text = clean(name), normalized = key(text);
    if (!text || !normalized) return false;
    if (/^\d+(?:[.,]\d+)?$/.test(text)) return false;
    const letters = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-zÑñ]/g, '');
    if (letters.length < 4 && !/^(TE|BBQ|MILO|MRTE)$/i.test(normalized.replace(/\s/g, ''))) return false;
    if (letters.length >= 6 && !/[AEIOUÁÉÍÓÚÜaeiouáéíóúü]/.test(text)) return false;
    if ((text.match(/[{}<>_=~^`\\]/g) || []).length > 1) return false;
    if (/^(YR|RNG|GAA|OOOM|000M)$/i.test(normalized.replace(/\s/g, ''))) return false;
    return true;
  }

  function plausiblePrice(value, currency = 'COP') {
    const price = Number(value);
    if (!Number.isFinite(price) || price <= 0) return false;
    if (String(currency || '').toUpperCase() === 'COP') {
      if (price < 1000 || price > 2000000) return false;
      const rounded = Math.round(price);
      const commercialEnding = rounded % 50 === 0 || rounded % 1000 === 990 || rounded % 1000 === 900;
      if (!commercialEnding) return false;
    } else if (price > 1000000000) return false;
    return true;
  }

  function supportCount(row, passRows) {
    let support = 0;
    for (const rows of Array.isArray(passRows) ? passRows : []) {
      if ((Array.isArray(rows) ? rows : []).some((candidate) => {
        const p1 = Number(row?.price || 0), p2 = Number(candidate?.price || 0);
        if (!(p1 > 0 && p2 > 0)) return false;
        const priceClose = Math.abs(p1 - p2) <= Math.max(50, p1 * 0.005);
        return priceClose && similarity(row?.subcategory, candidate?.subcategory) >= 0.60;
      })) support += 1;
    }
    return support;
  }

  function filterRows(rows, passRows, currency = 'COP', options = {}) {
    const trusted = Boolean(options.trustedText);
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(rows) ? rows : []) {
      const row = { ...raw };
      row.category = clean(row.category || 'Platos') || 'Platos';
      row.subcategory = clean(row.subcategory);
      row.price = Number(row.price || 0);
      if (!plausibleName(row.subcategory) || !plausiblePrice(row.price, currency)) continue;
      const confidence = Math.max(0, Math.min(1, Number(row.confidence || 0)));
      const support = trusted ? 3 : supportCount(row, passRows);
      const knownFamily = FAMILY.test(key(`${row.category} ${row.subcategory}`));
      if (!trusted && support < 2 && !(knownFamily && confidence >= 0.84)) continue;
      const id = `${key(row.category)}|${key(row.subcategory)}|${row.price}`;
      if (seen.has(id)) continue;
      seen.add(id);
      row.confidence = Math.max(confidence, Math.min(0.98, 0.64 + support * 0.09 + (knownFamily ? 0.04 : 0)));
      out.push(row);
    }
    return out.slice(0, 300);
  }

  return { MARKER, clean, key, editDistance, similarity, plausibleName, plausiblePrice, supportCount, filterRows };
});
