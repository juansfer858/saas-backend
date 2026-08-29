(() => {
  'use strict';
  const MARKER = 'VANTIX_MENU_OCR_QUALITY_POSTPROCESS_V2';
  const ANALYZE_PATH = '/api/v1/restaurante/carta-importacion/analizar';
  const priorFetch = window.fetch.bind(window);
  const key = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const clean = (v) => String(v ?? '').replace(/^[\s¡¿•·*\-–—|:;,.>_=+~]+/, '').replace(/[._·•]{2,}/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const familyRules = [
    [/\bCOMBO\b/,'Combos'],[/\bSALCHIPAPAS?\b/,'Salchipapas'],[/\bHAMBURGUESAS?\b/,'Hamburguesas'],[/\bPERROS?(?: CALIENTES?)?\b/,'Perros'],[/\bPIZZAS?\b/,'Pizzas'],
    [/\bTORNADOS?\b/,'Tornados'],[/\bCHUZOS?\b|\bBROCHETAS?\b/,'Chuzos'],[/\bPAPAS?\b/,'Papas'],[/\bALITAS?\b/,'Alitas'],[/\bPATACONES?\b/,'Patacones'],[/\bMAICITOS?\b/,'Maicitos'],
    [/\bJUGOS?\b|\bLIMONADAS?\b|\bGASEOSAS?\b|\bCERVEZAS?\b|\bMALTEADAS?\b|\bBEBIDAS?\b|\bAGUA\b|\bCAFE\b|\bCOCTELES?\b/,'Bebidas'],
    [/\bPOSTRES?\b|\bHELADOS?\b|\bBROWNIE\b|\bTORTAS?\b|\bFLAN\b|\bWAFFLES?\b/,'Postres'],[/\bENTRADAS?\b|\bNACHOS?\b|\bEMPANADAS?\b|\bAREPAS?\b/,'Entradas']
  ];
  function family(name) { const n = key(name); for (const [re, category] of familyRules) if (re.test(n)) return category; return null; }
  function titlePrefix(value) {
    let text = clean(value).replace(/^[A-Za-z0-9]{1,2}\s*[-:)>]+\s*/, '');
    text = (text.split(/(?:\s*(?:->|→|—{1,}|–{1,}|={2,}|-{3,}|\|)\s*|\.{3,})/)[0] || text).trim();
    const words = text.split(/\s+/).filter(Boolean).slice(0, 12), title = [];
    for (const word of words) {
      const letters = word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-zÑñ]/g, '');
      if (!letters) { if (title.length) break; continue; }
      if (letters === letters.toUpperCase()) title.push(word); else if (title.length >= 2) break; else { title.length = 0; break; }
    }
    while (title.length >= 3) { const first = key(title[0]); if (first.length <= 2 && !['TE','XL'].includes(first)) title.shift(); else break; }
    const chosen = title.length >= 2 ? title.join(' ') : text;
    return clean(chosen).replace(/\s+(?:con|incluye|acompañado|acompanado)$/i, '').trim();
  }
  function operational(category, name) {
    const value = `${key(category)} ${key(name)}`;
    if (/(BEBIDA|JUGO|GASEOSA|SODA|AGUA|CAFE|CERVEZA|VINO|COCTEL|LIMONADA|MALTEADA|\bTE\b|CHOCOLATE)/.test(value)) return 'BEBIDAS';
    if (/(POSTRE|HELADO|TORTA|PASTEL|BROWNIE|FLAN|TIRAMISU|DULCE|WAFFLE)/.test(value)) return 'POSTRES';
    if (/(ENTRADA|PICADA|NACHO|EMPANADA|AREPA|PAN DE AJO|ALITA|PATACON)/.test(value)) return 'ENTRADAS';
    return 'FUERTES';
  }
  const station = (op) => op === 'BEBIDAS' ? 'BARRA' : op === 'POSTRES' ? 'POSTRES' : 'COCINA';
  function polish(items) {
    const out = [], seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      const name = titlePrefix(item.subcategory || ''); if (!name || name.length < 2) continue;
      const category = family(name) || clean(item.category || 'Platos') || 'Platos';
      const op = operational(category, name), price = Number(item.price || 0); if (!(price > 0)) continue;
      const dedupe = `${key(category)}|${key(name)}|${price}`; if (seen.has(dedupe)) continue; seen.add(dedupe);
      out.push({ ...item, category, subcategory:name, operationalCategory:op, station:station(op) });
    }
    return out;
  }
  const pathOf = (input) => { try { return new URL(typeof input === 'string' ? input : input.url, location.origin).pathname; } catch { return ''; } };
  window.fetch = async (input, init = {}) => {
    const response = await priorFetch(input, init);
    if (pathOf(input) !== ANALYZE_PATH || !response.ok) return response;
    const body = await response.clone().json().catch(() => null);
    if (body?.data?.provider !== 'BROWSER_OCR' || !Array.isArray(body?.data?.items)) return response;
    body.data.items = polish(body.data.items);
    body.data.qualityPostprocess = MARKER;
    return new Response(JSON.stringify(body), { status:response.status, headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' } });
  };
  window.VantixGCRestaurantOcrQualityV2 = { marker:MARKER, polish, titlePrefix };
})();
