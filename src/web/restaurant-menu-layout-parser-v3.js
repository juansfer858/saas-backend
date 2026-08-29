((root, factory) => {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VantixGCRestaurantLayoutOcrV3 = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  const MARKER = 'VANTIX_MENU_OCR_LAYOUT_V3';
  const CATEGORY_NAMES = [
    ['ESPECIAL HOUSE', 'Especial House'], ['MENU KIDS', 'Menú Kids'], ['HAMBURGUESAS', 'Hamburguesas'],
    ['SANDWICHES', 'Sándwiches'], ['SANDWICH', 'Sándwiches'], ['SALCHIPAPAS', 'Salchipapas'],
    ['TORNADOS', 'Tornados'], ['CHUZOS', 'Chuzos'], ['BROCHETAS', 'Chuzos'], ['PAPAS', 'Papas'],
    ['PERROS', 'Perros'], ['PIZZAS', 'Pizzas'], ['AREPAS', 'Arepas'], ['BEBIDAS', 'Bebidas'],
    ['POSTRES', 'Postres'], ['COMBOS', 'Combos'], ['PICADAS', 'Picadas'], ['ENTRADAS', 'Entradas'],
    ['JUGOS', 'Jugos'], ['CERVEZAS', 'Cervezas'], ['CAFES', 'Cafés'], ['HELADOS', 'Helados']
  ];
  const FAMILY_RULES = [
    [/\bCOMBO\b/, 'Combos'], [/\bSALCHIPAPAS?\b/, 'Salchipapas'], [/\bHAMBURGUESAS?\b/, 'Hamburguesas'],
    [/\bPERROS?(?: CALIENTES?)?\b/, 'Perros'], [/\bPIZZAS?\b/, 'Pizzas'], [/\bTORNADOS?\b/, 'Tornados'],
    [/\bCHUZOS?\b|\bBROCHETAS?\b/, 'Chuzos'], [/\bPAPAS?\b/, 'Papas'], [/\bALITAS?\b/, 'Alitas'],
    [/\bPATACONES?\b/, 'Patacones'], [/\bMAICITOS?\b/, 'Maicitos'],
    [/\bJUGOS?\b|\bLIMONADAS?\b|\bGASEOSAS?\b|\bCERVEZAS?\b|\bMALTEADAS?\b|\bBEBIDAS?\b|\bAGUA\b|\bCAFE\b|\bCOCTELES?\b/, 'Bebidas'],
    [/\bPOSTRES?\b|\bHELADOS?\b|\bBROWNIE\b|\bTORTAS?\b|\bFLAN\b|\bWAFFLES?\b/, 'Postres'],
    [/\bENTRADAS?\b|\bNACHOS?\b|\bEMPANADAS?\b|\bAREPAS?\b/, 'Entradas']
  ];

  const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const key = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const bbox = (item) => item?.bbox || { x0:0, y0:0, x1:0, y1:0 };
  const width = (item) => Math.max(0, bbox(item).x1 - bbox(item).x0);
  const height = (item) => Math.max(0, bbox(item).y1 - bbox(item).y0);
  const cx = (item) => (bbox(item).x0 + bbox(item).x1) / 2;
  const cy = (item) => (bbox(item).y0 + bbox(item).y1) / 2;
  const union = (items) => ({
    x0:Math.min(...items.map((x) => bbox(x).x0)), y0:Math.min(...items.map((x) => bbox(x).y0)),
    x1:Math.max(...items.map((x) => bbox(x).x1)), y1:Math.max(...items.map((x) => bbox(x).y1))
  });

  function parseMoney(value) {
    let raw = String(value || '').toUpperCase().replace(/COP|PESOS?/g, '').replace(/\$/g, '').replace(/\s+/g, '').trim();
    if (!raw) return 0;
    const kilo = raw.endsWith('K');
    if (kilo) raw = raw.slice(0, -1);
    if (kilo) {
      const n = Number(raw.replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : 0;
    }
    if (/^\d{1,3}([.,]\d{3})+$/.test(raw) || (raw.includes('.') && raw.includes(',')) || /^\d+[.,]\d{3}$/.test(raw)) raw = raw.replace(/[.,]/g, '');
    else raw = raw.replace(',', '.');
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  }

  function familyCategory(name) {
    const value = key(name);
    for (const [pattern, category] of FAMILY_RULES) if (pattern.test(value)) return category;
    return null;
  }

  function operational(category, product) {
    const value = `${key(category)} ${key(product)}`;
    if (/(BEBIDA|JUGO|GASEOSA|SODA|AGUA|CAFE|CERVEZA|VINO|COCTEL|LIMONADA|MALTEADA|\bTE\b|CHOCOLATE)/.test(value)) return 'BEBIDAS';
    if (/(POSTRE|HELADO|TORTA|PASTEL|BROWNIE|FLAN|TIRAMISU|DULCE|WAFFLE)/.test(value)) return 'POSTRES';
    if (/(ENTRADA|PICADA|NACHO|EMPANADA|AREPA|PAN DE AJO|ALITA|PATACON)/.test(value)) return 'ENTRADAS';
    return 'FUERTES';
  }
  const station = (op) => op === 'BEBIDAS' ? 'BARRA' : op === 'POSTRES' ? 'POSTRES' : 'COCINA';

  function flattenLines(blocks) {
    const lines = [];
    for (const block of Array.isArray(blocks) ? blocks : []) {
      for (const paragraph of Array.isArray(block?.paragraphs) ? block.paragraphs : []) {
        for (const line of Array.isArray(paragraph?.lines) ? paragraph.lines : []) {
          const words = (Array.isArray(line?.words) ? line.words : []).filter((word) => clean(word?.text));
          if (!words.length) continue;
          lines.push({ ...line, words, bbox:line.bbox || union(words), text:clean(line.text || words.map((w) => w.text).join(' ')) });
        }
      }
    }
    return lines.sort((a,b) => bbox(a).y0 - bbox(b).y0 || bbox(a).x0 - bbox(b).x0);
  }

  function clusterWords(words, pageWidth) {
    const sorted = [...words].sort((a,b) => bbox(a).x0 - bbox(b).x0);
    if (!sorted.length) return [];
    const heights = sorted.map(height).filter(Boolean).sort((a,b) => a-b);
    const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 8;
    const gapThreshold = Math.max(14, pageWidth * 0.025, medianH * 2.3);
    const clusters = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i-1], word = sorted[i];
      const gap = bbox(word).x0 - bbox(prev).x1;
      if (gap > gapThreshold) clusters.push([word]); else clusters[clusters.length - 1].push(word);
    }
    return clusters;
  }

  function priceGroups(words) {
    const sorted = [...words].sort((a,b) => bbox(a).x0 - bbox(b).x0);
    const groups = [];
    for (let i = 0; i < sorted.length; i += 1) {
      const t = clean(sorted[i].text);
      let text = t, items = [sorted[i]];
      if (/^\$$/.test(t) && i + 1 < sorted.length) { text += clean(sorted[i+1].text); items.push(sorted[++i]); }
      const value = parseMoney(text);
      const explicit = /\$|COP|PESO/i.test(text) || /[.,]\d{3}\b/.test(text) || /\d\s*[Kk]\b/.test(text);
      if (value >= 500 && (explicit || value >= 1000)) groups.push({ value, words:items, bbox:union(items), start:sorted.indexOf(items[0]), end:sorted.indexOf(items[items.length - 1]) });
    }
    return groups;
  }

  function isConnector(word) { return /^(DE|DEL|LA|LAS|LOS|EL|Y|CON|AL|A|O)$/i.test(clean(word?.text)); }
  function isGarbagePrefix(word) {
    const t = key(word?.text);
    return t.length <= 2 && !['TE','XL'].includes(t) && Number(word?.confidence || 0) < 75;
  }

  function titleFromWords(words) {
    const source = [...words].filter((word) => clean(word?.text));
    if (!source.length) return '';
    while (source.length > 1 && isGarbagePrefix(source[0])) source.shift();
    if (!source.length) return '';
    const maxH = Math.max(...source.map(height), 1);
    const major = [];
    let started = false;
    for (const word of source) {
      const t = clean(word.text).replace(/^[¡¿•·*\-–—|:;,.>_=+~]+|[,:;]+$/g, '');
      if (!t) continue;
      const h = height(word), letters = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-zÑñ]/g, '');
      const uppercase = letters && letters === letters.toUpperCase();
      const big = h >= maxH * 0.72;
      if (!started) {
        if (big || uppercase) { major.push(t); started = true; }
        continue;
      }
      if (big || uppercase || isConnector(word)) major.push(t); else break;
    }
    let title = clean(major.join(' '));
    title = title.replace(/^[A-Za-z0-9]{1,2}\s*[-:)>]+\s*/, '').replace(/\s+(?:con|incluye|acompañado|acompanado)$/i, '').trim();
    if (title.length < 2 || title.length > 90) return '';
    return title;
  }

  function titleScore(title) {
    const text = clean(title), words = text.split(/\s+/).filter(Boolean);
    if (!text || text.length > 90 || words.length > 9) return -100;
    let score = text.length <= 58 ? 30 : 12;
    score += words.length <= 6 ? 25 : 5;
    if (familyCategory(text)) score += 25;
    if (/^(CON|INCLUYE|ACOMPANADO|ACOMPAÑADO|LLEVA|PAN |CARNE |POLLO |QUESO |SALSA )/i.test(text)) score -= 50;
    score -= (text.match(/[{}<>_=~^`\\]/g) || []).length * 8;
    return score;
  }

  function categoryAtY(y, anchors) {
    if (!Array.isArray(anchors) || !anchors.length) return null;
    let best = null;
    for (const anchor of anchors) {
      const distance = Math.abs(Number(anchor.y) - y);
      if (!best || distance < best.distance) best = { distance, category:anchor.category };
    }
    return best?.category || null;
  }

  function candidateClusters(lines, pageWidth) {
    const candidates = [];
    for (const line of lines) {
      if (priceGroups(line.words).length) continue;
      for (const words of clusterWords(line.words, pageWidth)) {
        const title = titleFromWords(words);
        if (!title || titleScore(title) < 30) continue;
        const box = union(words);
        candidates.push({ title, bbox:box, x:cx({bbox:box}), y:cy({bbox:box}), score:titleScore(title) });
      }
    }
    return candidates;
  }

  function nearestTitle(priceBox, candidates, pageWidth, pageHeight) {
    const px = cx({bbox:priceBox}), py = cy({bbox:priceBox});
    let best = null;
    for (const candidate of candidates) {
      const dy = py - candidate.y;
      if (dy < -pageHeight * 0.012 || dy > pageHeight * 0.11) continue;
      const dx = Math.abs(px - candidate.x);
      if (dx > pageWidth * 0.20) continue;
      const overlap = Math.max(0, Math.min(priceBox.x1, candidate.bbox.x1) - Math.max(priceBox.x0, candidate.bbox.x0));
      const horizontalBonus = overlap > 0 ? -30 : 0;
      const score = Math.max(0, dy) * 1.4 + dx * 0.7 + horizontalBonus - candidate.score * 0.25;
      if (!best || score < best.score) best = { ...candidate, score };
    }
    return best;
  }

  function makeRow(name, price, y, anchors, confidence = .82, explicitCategory = null) {
    const family = familyCategory(name);
    const category = family || explicitCategory || categoryAtY(y, anchors) || 'Platos';
    const op = operational(category, name);
    return { category, subcategory:clean(name), price, operationalCategory:op, station:station(op), confidence:Math.max(.45, Math.min(.98, confidence)) };
  }

  function parseBlocks(blocks, pageWidth, pageHeight, anchors = []) {
    const lines = flattenLines(blocks);
    const candidates = candidateClusters(lines, pageWidth);
    const rows = [];
    const seen = new Set();
    const push = (row) => {
      if (!row?.subcategory || !(row.price > 0)) return;
      const id = `${key(row.category)}|${key(row.subcategory)}|${row.price}`;
      if (seen.has(id)) return; seen.add(id); rows.push(row);
    };

    for (const line of lines) {
      const sorted = [...line.words].sort((a,b) => bbox(a).x0 - bbox(b).x0);
      const prices = priceGroups(sorted);
      if (!prices.length) continue;
      let priorEnd = -1;
      let priorProduct = null;
      for (let p = 0; p < prices.length; p += 1) {
        const price = prices[p];
        const segment = sorted.filter((word) => bbox(word).x0 >= (priorEnd < 0 ? -Infinity : priorEnd) && bbox(word).x1 <= price.bbox.x0 + 1);
        let title = titleFromWords(segment);
        if (title && /^(COMBO|GRATINADO)$/i.test(key(title)) && priorProduct) title = `${priorProduct} ${key(title)}`;
        if (!title && priorProduct && p > 0 && price.bbox.x0 > pageWidth * 0.66) title = `${priorProduct} COMBO`;
        if (!title) {
          const nearest = nearestTitle(price.bbox, candidates, pageWidth, pageHeight);
          if (nearest) title = nearest.title;
        }
        if (title && titleScore(title) >= 0) {
          const avgConf = segment.length ? segment.reduce((sum,w) => sum + Number(w.confidence || 0), 0) / segment.length : 76;
          const row = makeRow(title, price.value, cy({bbox:price.bbox}), anchors, avgConf / 100);
          push(row);
          priorProduct = row.subcategory.replace(/\s+(COMBO|GRATINADO)$/i, '');
        }
        priorEnd = price.bbox.x1;
      }
    }
    return rows.slice(0, 300);
  }

  function detectCategoryAnchorsFromRotatedBlocks(blocks, originalHeight) {
    const anchors = [];
    for (const line of flattenLines(blocks)) {
      const normalized = key(line.text);
      for (const [needle, category] of CATEGORY_NAMES) {
        if (!normalized.includes(needle)) continue;
        const box = bbox(line);
        const originalY = originalHeight - ((box.x0 + box.x1) / 2);
        anchors.push({ y:originalY, category, confidence:Number(line.confidence || 0) / 100 });
        break;
      }
    }
    return anchors.sort((a,b) => a.y - b.y);
  }

  return { MARKER, parseBlocks, detectCategoryAnchorsFromRotatedBlocks, flattenLines, titleFromWords, priceGroups, familyCategory, parseMoney };
});
