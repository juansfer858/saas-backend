(() => {
  'use strict';
  const MARKER = 'VANTIX_BROWSER_OCR_V1';
  const QUALITY_MARKER = 'VANTIX_BROWSER_OCR_MULTIPASS_V2';
  const STATUS_PATH = '/api/v1/restaurante/carta-importacion/status';
  const ANALYZE_PATH = '/api/v1/restaurante/carta-importacion/analizar';
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_PDF_PAGES = 8;
  const PSM_MODES = ['6', '11', '4'];
  const LANGUAGE_PROFILES = [['spa', 'eng'], ['spa'], ['eng']];
  const nativeFetch = window.fetch.bind(window);
  let browserMode = false;

  const clean = (v, n = 180) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const key = (v) => clean(v, 220).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' } });
  const pathOf = (input) => { try { return new URL(typeof input === 'string' ? input : input.url, location.origin).pathname; } catch { return ''; } };

  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    const found = [...document.scripts].find((s) => s.src === src);
    if (found) return new Promise((resolve, reject) => {
      if (ready()) return resolve();
      found.addEventListener('load', () => ready() ? resolve() : reject(new Error('No cargó el motor OCR')), { once:true });
      found.addEventListener('error', () => reject(new Error('No fue posible cargar el motor OCR')), { once:true });
    });
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => ready() ? resolve() : reject(new Error('No cargó el motor OCR'));
      script.onerror = () => reject(new Error('No fue posible cargar el motor OCR'));
      document.head.appendChild(script);
    });
  }

  function price(v) {
    let raw = String(v || '').toUpperCase().replace(/COP|PESOS?/g, '').replace(/\$/g, '').replace(/\s+/g, '').trim();
    if (!raw) return 0;
    const kilo = raw.endsWith('K');
    if (kilo) raw = raw.slice(0, -1);
    if (kilo) {
      const num = Number(raw.replace(',', '.'));
      return Number.isFinite(num) && num > 0 ? Math.round(num * 1000) : 0;
    }
    if (/^\d{1,3}([.,]\d{3})+$/.test(raw) || (raw.includes('.') && raw.includes(',')) || /^\d+[.,]\d{3}$/.test(raw)) raw = raw.replace(/[.,]/g, '');
    else raw = raw.replace(',', '.');
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? Math.round(num * 100) / 100 : 0;
  }

  function operational(category, product) {
    const value = `${key(category)} ${key(product)}`;
    if (/(BEBIDA|JUGO|GASEOSA|SODA|AGUA|CAFE|CERVEZA|VINO|COCTEL|LIMONADA|MALTEADA|\bTE\b|CHOCOLATE)/.test(value)) return 'BEBIDAS';
    if (/(POSTRE|HELADO|TORTA|PASTEL|BROWNIE|FLAN|TIRAMISU|DULCE|WAFFLE)/.test(value)) return 'POSTRES';
    if (/(ENTRADA|PICADA|NACHO|EMPANADA|AREPA|PAN DE AJO|ALITA|PATACON)/.test(value)) return 'ENTRADAS';
    return 'FUERTES';
  }

  const station = (c) => c === 'BEBIDAS' ? 'BARRA' : c === 'POSTRES' ? 'POSTRES' : 'COCINA';
  const fallbackCategory = (c) => c === 'BEBIDAS' ? 'Bebidas' : c === 'POSTRES' ? 'Postres' : c === 'ENTRADAS' ? 'Entradas' : 'Platos';

  const headings = new Map([
    ['HAMBURGUESAS','Hamburguesas'],['HAMBURGUESA','Hamburguesas'],['PERROS','Perros'],['PERROS CALIENTES','Perros'],['PIZZAS','Pizzas'],['PIZZA','Pizzas'],
    ['SALCHIPAPAS','Salchipapas'],['SALCHIPAPA','Salchipapas'],['PAPAS','Papas'],['TORNADOS','Tornados'],['TORNADO','Tornados'],['CHUZOS','Chuzos'],['CHUZO','Chuzos'],['BROCHETAS','Chuzos'],
    ['ALITAS','Alitas'],['PATACONES','Patacones'],['MAICITOS','Maicitos'],['ENTRADAS','Entradas'],['BEBIDAS','Bebidas'],['JUGOS','Jugos'],['JUGOS NATURALES','Jugos'],
    ['GASEOSAS','Gaseosas'],['CERVEZAS','Cervezas'],['COCTELES','Cócteles'],['CAFES','Cafés'],['POSTRES','Postres'],['HELADOS','Helados'],['DESAYUNOS','Desayunos'],['ALMUERZOS','Almuerzos'],
    ['PASTAS','Pastas'],['ARROCES','Arroces'],['CARNES','Carnes'],['POLLO','Pollo'],['PESCADOS','Pescados'],['ENSALADAS','Ensaladas'],['SOPAS','Sopas'],['PICADAS','Picadas'],
    ['COMBOS','Combos'],['AREPAS','Arepas'],['EMPANADAS','Empanadas'],['SANDWICHES','Sándwiches'],['SANDWICH','Sándwiches']
  ]);

  const familyRules = [
    [/\bCOMBO\b/, 'Combos'], [/\bSALCHIPAPAS?\b/, 'Salchipapas'], [/\bHAMBURGUESAS?\b/, 'Hamburguesas'], [/\bPERROS?(?: CALIENTES?)?\b/, 'Perros'],
    [/\bPIZZAS?\b/, 'Pizzas'], [/\bTORNADOS?\b/, 'Tornados'], [/\bCHUZOS?\b|\bBROCHETAS?\b/, 'Chuzos'], [/\bPAPAS?\b/, 'Papas'], [/\bALITAS?\b/, 'Alitas'],
    [/\bPATACONES?\b/, 'Patacones'], [/\bMAICITOS?\b/, 'Maicitos'],
    [/\bJUGOS?\b|\bLIMONADAS?\b|\bGASEOSAS?\b|\bCERVEZAS?\b|\bMALTEADAS?\b|\bBEBIDAS?\b|\bAGUA\b|\bCAFE\b|\bCOCTELES?\b/, 'Bebidas'],
    [/\bPOSTRES?\b|\bHELADOS?\b|\bBROWNIE\b|\bTORTAS?\b|\bFLAN\b|\bWAFFLES?\b/, 'Postres'],
    [/\bENTRADAS?\b|\bNACHOS?\b|\bEMPANADAS?\b|\bAREPAS?\b/, 'Entradas']
  ];

  function heading(line) {
    const value = clean(line, 80).replace(/^[•·*\-–—]+\s*/, '').replace(/[:.]+$/, '').trim();
    const normalized = key(value);
    if (headings.has(normalized)) return headings.get(normalized);
    const letters = value.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
    const uppers = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '');
    return letters.length >= 4 && value.length <= 45 && value.split(/\s+/).length <= 5 && uppers.length / letters.length >= .88
      ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : null;
  }

  const noise = (line) => /(WHATSAPP|INSTAGRAM|FACEBOOK|DIRECCION|DOMICILIO|RESERVAS|TELEFONO|CELULAR|HORARIO|NIT\b|SIGUENOS|VISITANOS|WWW\b|@)/.test(key(line));
  const productText = (v) => clean(v, 180).replace(/^[\s•·*\-–—|:;,.>_=+~]+/, '').replace(/[._·•]{2,}/g, ' ').replace(/\s+[|:;\-–—]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();

  function familyCategory(product) {
    const value = key(product);
    for (const [pattern, category] of familyRules) if (pattern.test(value)) return category;
    return null;
  }

  function extractUppercaseTitle(value) {
    const cleaned = productText(value);
    const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 12);
    if (words.length < 2) return '';
    const connectors = new Set(['DE','DEL','LA','LAS','LOS','EL','CON','Y','AL','A']);
    const title = [];
    for (const word of words) {
      const letters = word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-zÑñ]/g, '');
      if (!letters) { if (title.length) break; continue; }
      const upper = letters === letters.toUpperCase();
      if (upper || (title.length && connectors.has(letters.toUpperCase()))) title.push(word);
      else if (title.length >= 2) break;
      else return '';
    }
    while (title.length >= 3) {
      const first = key(title[0]);
      if (first.length <= 2 && !['TE','XL'].includes(first)) title.shift();
      else break;
    }
    const out = productText(title.join(' '));
    return title.length >= 2 && out.length >= 4 && out.length <= 80 ? out : '';
  }

  function productCandidate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const strong = raw.split(/(?:\s*(?:->|→|—{1,}|–{1,}|={2,}|-{3,}|\|)\s*|\.{3,})/)[0] || raw;
    const cleaned = productText(strong);
    return productText(extractUppercaseTitle(cleaned) || cleaned);
  }

  function candidateScore(value) {
    const text = productText(value);
    if (!text || noise(text)) return -1000;
    const words = text.split(/\s+/).filter(Boolean);
    const letters = text.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
    if (!letters) return -1000;
    const uppers = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '');
    const upperRatio = uppers.length / letters.length;
    let score = 0;
    if (text.length >= 4 && text.length <= 58) score += 28; else if (text.length <= 82) score += 10; else score -= 25;
    if (words.length >= 1 && words.length <= 6) score += 24; else if (words.length > 10) score -= 30;
    if (upperRatio >= .72 && words.length >= 2) score += 24;
    if (familyCategory(text)) score += 24;
    if (/^(CON|ACOMPANADO|INCLUYE|SERVIDO|PREPARADO|TIENE|LLEVA)\b/i.test(text)) score -= 45;
    score -= (text.match(/[{}<>_=~^`\\]/g) || []).length * 6;
    return score;
  }

  function chooseProduct(beforePrice, pendingLines) {
    const candidates = [productCandidate(beforePrice), ...pendingLines.slice().reverse().map(productCandidate)].filter(Boolean);
    let best = ''; let bestScore = -Infinity;
    for (const candidate of candidates) {
      const score = candidateScore(candidate);
      if (score > bestScore) { best = candidate; bestScore = score; }
    }
    return bestScore >= 0 ? best : '';
  }

  function priceMatches(line) {
    const re = /(?:COP\s*)?\$?\s*(?:\d{1,3}(?:[.,]\d{3})+|\d{4,9}|\d{1,3}(?:[.,]\d{1,2})?\s*[Kk])(?:\s*(?:COP|PESOS?))?/gi;
    const out = []; let match;
    while ((match = re.exec(line)) !== null) {
      const value = price(match[0]);
      if (value > 0) out.push({ value, index:match.index, end:match.index + match[0].length });
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
    return out;
  }

  function parseMenuText(text, options = {}) {
    const lines = String(text || '').replace(/\r/g, '\n').split(/\n+/).map((line) => line.replace(/[\t]+/g, ' ').trim()).filter(Boolean);
    let category = 'Otros'; let pending = []; const rows = []; const seen = new Set();
    const baseConfidence = Number.isFinite(Number(options.baseConfidence)) ? Number(options.baseConfidence) : null;
    for (const rawLine of lines) {
      const line = clean(rawLine, 320);
      if (noise(line)) continue;
      const matches = priceMatches(line);
      if (!matches.length) {
        const h = heading(line);
        if (h) { category = h; pending = []; }
        else if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(line) && line.length <= 100) { pending.push(line); if (pending.length > 4) pending.shift(); }
        continue;
      }
      const name = chooseProduct(rawLine.slice(0, matches[0].index), pending);
      pending = [];
      if (!name || name.length < 2) continue;
      const family = familyCategory(name);
      const op = operational(family || category, name);
      const commercial = family || (category !== 'Otros' ? category : fallbackCategory(op));
      const dedupe = `${key(commercial)}|${key(name)}|${matches[0].value}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      let confidence = baseConfidence ?? (category === 'Otros' ? .68 : .84);
      if (family) confidence += .05;
      if (candidateScore(name) < 35) confidence -= .12;
      rows.push({ category:commercial, subcategory:name, price:matches[0].value, operationalCategory:op, station:station(op), confidence:Math.max(.45, Math.min(.98, confidence)) });
      if (rows.length >= 300) break;
    }
    return rows;
  }

  function menuOcrScore(text) {
    const source = String(text || '');
    if (!source.trim()) return -100000;
    const rows = parseMenuText(source);
    const lines = source.split(/\r?\n/).map((x) => clean(x, 320)).filter(Boolean);
    const categories = new Set(rows.map((row) => key(row.category)));
    let score = rows.length * 140 + categories.size * 24;
    for (const line of lines) {
      if (priceMatches(line).length) score += 18;
      if (heading(line)) score += 12;
      score -= (line.match(/[{}<>_=~^`\\]/g) || []).length * 4;
    }
    score += Math.min(120, (source.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length / 12);
    score -= (source.match(/[�]/g) || []).length * 25;
    return score;
  }

  async function prepareImage(blob) {
    let source = null; let release = () => {}; let width = 0; let height = 0;
    try {
      if ('createImageBitmap' in window) {
        source = await createImageBitmap(blob); width = source.width; height = source.height; release = () => source.close?.();
      } else {
        const url = URL.createObjectURL(blob); const img = new Image(); img.src = url; await img.decode();
        source = img; width = img.naturalWidth; height = img.naturalHeight; release = () => URL.revokeObjectURL(url);
      }
      const side = Math.max(width || 1, height || 1);
      let scale = 1;
      if (side < 2800) scale = Math.min(2, 3000 / side);
      if (side * scale > 4300) scale = 4300 / side;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d', { alpha:false });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally { release(); }
  }

  async function createOcrWorker(languages) {
    await loadScript(TESSERACT_URL, () => Boolean(window.Tesseract?.createWorker));
    return window.Tesseract.createWorker(languages);
  }

  async function recognizeMultiPass(source, profiles = LANGUAGE_PROFILES) {
    let best = null; let passes = 0;
    for (const languages of profiles) {
      const w = await createOcrWorker(languages);
      try {
        for (const psm of PSM_MODES) {
          await w.setParameters({ tessedit_pageseg_mode:psm, preserve_interword_spaces:'1', user_defined_dpi:'220' });
          const result = await w.recognize(source);
          const text = String(result?.data?.text || '');
          const confidence = Math.max(0, Math.min(100, Number(result?.data?.confidence || 0)));
          const score = menuOcrScore(text) + confidence * 2;
          passes += 1;
          if (!best || score > best.score) best = { text, score, confidence, engine:`tesseract:${languages.join('+')}:psm${psm}`, passes };
        }
      } finally { await w.terminate().catch(() => {}); }
    }
    if (!best?.text?.trim()) throw new Error('El OCR no pudo reconocer texto útil en la carta.');
    best.passes = passes;
    return best;
  }

  async function ocrImage(blob) {
    const canvas = await prepareImage(blob);
    return recognizeMultiPass(canvas, LANGUAGE_PROFILES);
  }

  async function ocrPdf(blob) {
    await loadScript(PDFJS_URL, () => Boolean(window.pdfjsLib?.getDocument));
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    const pdf = await window.pdfjsLib.getDocument({ data:new Uint8Array(await blob.arrayBuffer()) }).promise;
    const pages = Math.min(Number(pdf.numPages || 0), MAX_PDF_PAGES);
    let textLayer = '';
    for (let i = 1; i <= pages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      textLayer += content.items.map((item) => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`).join('') + '\n';
    }
    const textRows = parseMenuText(textLayer, { baseConfidence:.97 });
    if (textRows.length >= 2 && menuOcrScore(textLayer) > 250) return { text:textLayer, engine:'pdf:text-layer', confidence:97, score:menuOcrScore(textLayer), passes:0 };

    let combined = ''; let score = 0; let confidenceTotal = 0; let passTotal = 0;
    for (let i = 1; i <= pages; i += 1) {
      const page = await pdf.getPage(i);
      const baseViewport = page.getViewport({ scale:1 });
      const targetScale = Math.min(3.1, 4300 / Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale:Math.max(1.8, targetScale) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { alpha:false });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext:ctx, viewport }).promise;
      const pageResult = await recognizeMultiPass(canvas, [['spa','eng']]);
      combined += `${pageResult.text}\n`;
      score += pageResult.score; confidenceTotal += pageResult.confidence; passTotal += pageResult.passes;
    }
    return { text:combined, engine:`pdf:ocr:spa+eng:psm6-11-4`, confidence:pages ? confidenceTotal / pages : 0, score, passes:passTotal };
  }

  function base64Blob(payload) {
    const raw = atob(String(payload.dataBase64 || ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type:payload.mimeType || 'application/octet-stream' });
  }

  async function browserAnalyze(payload) {
    const blob = base64Blob(payload);
    const recognized = payload.mimeType === 'application/pdf' ? await ocrPdf(blob) : await ocrImage(blob);
    const baseConfidence = Math.max(.5, Math.min(.98, Number(recognized.confidence || 0) / 100));
    const items = parseMenuText(recognized.text, { baseConfidence });
    if (!items.length) throw new Error('No se encontraron productos con nombre y precio suficientemente claros. Prueba con una foto más recta y nítida.');
    return {
      fileName:payload.fileName || 'carta', mimeType:payload.mimeType, bytes:blob.size,
      provider:'BROWSER_OCR', marker:MARKER, qualityMarker:QUALITY_MARKER,
      engine:recognized.engine, recognitionScore:Math.round(recognized.score || 0), recognitionPasses:recognized.passes || 0,
      items
    };
  }

  window.fetch = async (input, init = {}) => {
    const path = pathOf(input);
    if (path === STATUS_PATH) {
      try {
        const response = await nativeFetch(input, init);
        const copy = response.clone();
        const body = await copy.json().catch(() => null);
        if (response.ok && body?.data?.configured) { browserMode = false; return response; }
        browserMode = true;
      } catch { browserMode = true; }
      return jsonResponse({ ok:true, data:{
        configured:true, provider:'BROWSER_OCR', marker:MARKER, qualityMarker:QUALITY_MARKER,
        maxBytes:MAX_BYTES, acceptedMimeTypes:['application/pdf','image/jpeg','image/png','image/webp'],
        preserveOriginalImage:true, multipass:true, languages:['spa+eng','spa','eng'], psmModes:PSM_MODES,
        note:'OCR multipase del navegador listo'
      } });
    }
    if (path === ANALYZE_PATH && browserMode) {
      try {
        const payload = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({ ok:true, data:await browserAnalyze(payload) });
      } catch (error) {
        return jsonResponse({ ok:false, error:{ code:'RESTAURANT_MENU_BROWSER_OCR_ERROR', message:error?.message || 'No fue posible reconocer la carta' } }, 502);
      }
    }
    return nativeFetch(input, init);
  };

  window.VantixGCRestaurantBrowserOcr = { marker:MARKER, qualityMarker:QUALITY_MARKER, parseMenuText, menuOcrScore, productCandidate };
})();
