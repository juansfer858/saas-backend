(() => {
  'use strict';
  const MARKER = 'VANTIX_BROWSER_OCR_V1';
  const STATUS_PATH = '/api/v1/restaurante/carta-importacion/status';
  const ANALYZE_PATH = '/api/v1/restaurante/carta-importacion/analizar';
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_PDF_PAGES = 8;
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
      script.src = src; script.async = true; script.crossOrigin = 'anonymous';
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
    if (/(BEBIDA|JUGO|GASEOSA|SODA|AGUA|CAFE|CERVEZA|VINO|COCTEL|LIMONADA|MALTEADA|TE |CHOCOLATE)/.test(value)) return 'BEBIDAS';
    if (/(POSTRE|HELADO|TORTA|PASTEL|BROWNIE|FLAN|TIRAMISU|DULCE|WAFFLE)/.test(value)) return 'POSTRES';
    if (/(ENTRADA|PICADA|NACHO|EMPANADA|AREPA|PAN DE AJO|ALITA|PATACON)/.test(value)) return 'ENTRADAS';
    return 'FUERTES';
  }
  const station = (c) => c === 'BEBIDAS' ? 'BARRA' : c === 'POSTRES' ? 'POSTRES' : 'COCINA';
  const fallbackCategory = (c) => c === 'BEBIDAS' ? 'Bebidas' : c === 'POSTRES' ? 'Postres' : c === 'ENTRADAS' ? 'Entradas' : 'Platos';
  const headings = new Map([
    ['HAMBURGUESAS','Hamburguesas'],['HAMBURGUESA','Hamburguesas'],['PERROS','Perros'],['PERROS CALIENTES','Perros'],['PIZZAS','Pizzas'],['PIZZA','Pizzas'],
    ['ENTRADAS','Entradas'],['BEBIDAS','Bebidas'],['JUGOS','Jugos'],['JUGOS NATURALES','Jugos'],['GASEOSAS','Gaseosas'],['CERVEZAS','Cervezas'],
    ['COCTELES','Cócteles'],['CAFES','Cafés'],['POSTRES','Postres'],['HELADOS','Helados'],['DESAYUNOS','Desayunos'],['ALMUERZOS','Almuerzos'],
    ['PASTAS','Pastas'],['ARROCES','Arroces'],['CARNES','Carnes'],['POLLO','Pollo'],['PESCADOS','Pescados'],['ENSALADAS','Ensaladas'],
    ['SOPAS','Sopas'],['PICADAS','Picadas'],['COMBOS','Combos'],['AREPAS','Arepas'],['EMPANADAS','Empanadas'],['SANDWICHES','Sándwiches']
  ]);

  function heading(line) {
    const value = clean(line, 80).replace(/^[•·*\-–—]+\s*/, '').replace(/[:.]+$/, '').trim();
    const normalized = key(value);
    if (headings.has(normalized)) return headings.get(normalized);
    const letters = value.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
    const uppers = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '');
    return letters.length >= 4 && value.length <= 45 && value.split(/\s+/).length <= 5 && uppers.length / letters.length >= .86
      ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : null;
  }
  const noise = (line) => /(WHATSAPP|INSTAGRAM|FACEBOOK|DIRECCION|DOMICILIO|RESERVAS|TELEFONO|CELULAR|HORARIO|NIT\b|SIGUENOS|VISITANOS)/.test(key(line));
  const productText = (v) => clean(v, 180).replace(/^[•·*\-–—]+\s*/, '').replace(/[._·•]{2,}/g, ' ').replace(/\s+[|:;\-–—]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();

  function priceMatches(line) {
    const re = /(?:COP\s*)?\$?\s*(?:\d{1,3}(?:[.,]\d{3})+|\d{4,9}|\d{1,3}(?:[.,]\d{1,2})?\s*[Kk])(?:\s*(?:COP|PESOS?))?/gi;
    const out = []; let match;
    while ((match = re.exec(line)) !== null) {
      const value = price(match[0]);
      if (value > 0) out.push({ value, index:match.index });
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
    return out;
  }

  function parseMenuText(text) {
    const lines = String(text || '').replace(/\r/g, '\n').replace(/[\t]+/g, ' ').split(/\n+/).map((line) => clean(line, 260)).filter(Boolean);
    let category = 'Otros'; let pending = ''; const rows = []; const seen = new Set();
    for (const line of lines) {
      if (noise(line)) continue;
      const matches = priceMatches(line);
      if (!matches.length) {
        const h = heading(line);
        if (h) { category = h; pending = ''; }
        else if (line.length <= 75 && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(line)) pending = productText(line);
        continue;
      }
      let name = productText(line.slice(0, matches[0].index)) || pending;
      pending = '';
      if (!name || name.length < 2) continue;
      const op = operational(category, name);
      const commercial = category !== 'Otros' ? category : fallbackCategory(op);
      const dedupe = `${key(commercial)}|${key(name)}|${matches[0].value}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      rows.push({ category:commercial, subcategory:name, price:matches[0].value, operationalCategory:op, station:station(op), confidence:category === 'Otros' ? .7 : .84 });
      if (rows.length >= 300) break;
    }
    return rows;
  }

  async function worker() {
    await loadScript(TESSERACT_URL, () => Boolean(window.Tesseract?.createWorker));
    return window.Tesseract.createWorker('spa');
  }

  async function ocrImage(blob) {
    const w = await worker();
    try {
      const result = await w.recognize(blob);
      return String(result?.data?.text || '');
    } finally { await w.terminate().catch(() => {}); }
  }

  async function ocrPdf(blob) {
    await loadScript(PDFJS_URL, () => Boolean(window.pdfjsLib?.getDocument));
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    const pdf = await window.pdfjsLib.getDocument({ data:new Uint8Array(await blob.arrayBuffer()) }).promise;
    const pages = Math.min(Number(pdf.numPages || 0), MAX_PDF_PAGES);
    let text = '';
    for (let i = 1; i <= pages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`).join('') + '\n';
    }
    if (parseMenuText(text).length) return text;
    const w = await worker();
    try {
      text = '';
      for (let i = 1; i <= pages; i += 1) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale:1.8 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext:canvas.getContext('2d', { alpha:false }), viewport }).promise;
        text += String((await w.recognize(canvas))?.data?.text || '') + '\n';
      }
      return text;
    } finally { await w.terminate().catch(() => {}); }
  }

  function base64Blob(payload) {
    const raw = atob(String(payload.dataBase64 || ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type:payload.mimeType || 'application/octet-stream' });
  }

  async function browserAnalyze(payload) {
    const blob = base64Blob(payload);
    const text = payload.mimeType === 'application/pdf' ? await ocrPdf(blob) : await ocrImage(blob);
    const items = parseMenuText(text);
    if (!items.length) throw new Error('No se encontraron productos con nombre y precio suficientemente claros. Prueba con una foto más recta y nítida.');
    return { fileName:payload.fileName || 'carta', mimeType:payload.mimeType, bytes:blob.size, provider:'BROWSER_OCR', marker:MARKER, items };
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
      return jsonResponse({ ok:true, data:{ configured:true, provider:'BROWSER_OCR', marker:MARKER, maxBytes:MAX_BYTES, acceptedMimeTypes:['application/pdf','image/jpeg','image/png','image/webp'], note:'OCR local del navegador listo' } });
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

  window.VantixGCRestaurantBrowserOcr = { marker:MARKER, parseMenuText };
})();
