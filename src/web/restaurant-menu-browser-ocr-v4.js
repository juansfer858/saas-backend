(() => {
  'use strict';
  const MARKER = 'VANTIX_BROWSER_OCR_PREPROCESS_V4';
  const STATUS_PATH = '/api/v1/restaurante/carta-importacion/status';
  const ANALYZE_PATH = '/api/v1/restaurante/carta-importacion/analizar';
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_PDF_PAGES = 8;
  const priorFetch = window.fetch.bind(window);
  const baseOcr = window.VantixGCRestaurantBrowserOcr;
  const layout = window.VantixGCRestaurantLayoutOcrV3;
  const strict = window.VantixGCRestaurantOcrStrictV4;
  let enabled = false;

  const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' } });
  const pathOf = (input) => { try { return new URL(typeof input === 'string' ? input : input.url, location.origin).pathname; } catch { return ''; } };
  const sessionCurrency = () => { try { return JSON.parse(localStorage.getItem('vantixgc_core_session_v1') || 'null')?.tenant?.moneda || 'COP'; } catch { return 'COP'; } };

  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    const found = [...document.scripts].find((s) => s.src === src);
    if (found) return new Promise((resolve, reject) => {
      found.addEventListener('load', () => ready() ? resolve() : reject(new Error('No cargó el motor OCR')), { once:true });
      found.addEventListener('error', () => reject(new Error('No fue posible cargar el motor OCR')), { once:true });
    });
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = src; script.async = true; script.crossOrigin = 'anonymous';
      script.onload = () => ready() ? resolve() : reject(new Error('No cargó el motor OCR'));
      script.onerror = () => reject(new Error('No fue posible cargar el motor OCR'));
      document.head.appendChild(script);
    });
  }

  async function sourceCanvas(blob) {
    let source = null, release = () => {}, width = 0, height = 0;
    try {
      if ('createImageBitmap' in window) { source = await createImageBitmap(blob); width = source.width; height = source.height; release = () => source.close?.(); }
      else { const url = URL.createObjectURL(blob), img = new Image(); img.src = url; await img.decode(); source = img; width = img.naturalWidth; height = img.naturalHeight; release = () => URL.revokeObjectURL(url); }
      const side = Math.max(width || 1, height || 1);
      const scale = Math.min(5, Math.max(2.5, 3600 / side), 4600 / side);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d', { alpha:false }); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(source,0,0,canvas.width,canvas.height);
      return canvas;
    } finally { release(); }
  }

  function otsuThreshold(data, step = 4) {
    const hist = new Uint32Array(256); let count = 0, totalSum = 0;
    for (let i = 0; i < data.length; i += 4 * step) {
      const gray = Math.round(data[i] * .299 + data[i+1] * .587 + data[i+2] * .114); hist[gray] += 1; count += 1; totalSum += gray;
    }
    let sumB = 0, weightB = 0, maxVariance = -1, threshold = 160;
    for (let t = 0; t < 256; t += 1) {
      weightB += hist[t]; if (!weightB) continue; const weightF = count - weightB; if (!weightF) break;
      sumB += t * hist[t];
      const meanB = sumB / weightB, meanF = (totalSum - sumB) / weightF, variance = weightB * weightF * (meanB - meanF) ** 2;
      if (variance > maxVariance) { maxVariance = variance; threshold = t; }
    }
    return Math.max(145, Math.min(182, threshold + 12));
  }

  function highContrastCanvas(canvas) {
    const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
    const ctx = out.getContext('2d', { alpha:false }); ctx.drawImage(canvas,0,0);
    const image = ctx.getImageData(0,0,out.width,out.height), threshold = otsuThreshold(image.data);
    for (let i = 0; i < image.data.length; i += 4) {
      const gray = Math.round(image.data[i] * .299 + image.data[i+1] * .587 + image.data[i+2] * .114);
      const value = gray < threshold ? 0 : 255;
      image.data[i] = value; image.data[i+1] = value; image.data[i+2] = value; image.data[i+3] = 255;
    }
    ctx.putImageData(image,0,0); out.dataset.ocrThreshold = String(threshold); return out;
  }

  function rotateClockwise(canvas) {
    const out = document.createElement('canvas'); out.width = canvas.height; out.height = canvas.width;
    const ctx = out.getContext('2d', { alpha:false }); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,out.width,out.height); ctx.translate(out.width,0); ctx.rotate(Math.PI/2); ctx.drawImage(canvas,0,0); return out;
  }

  async function createWorker() {
    await loadScript(TESSERACT_URL, () => Boolean(window.Tesseract?.createWorker));
    return window.Tesseract.createWorker(['spa','eng']);
  }

  function scoreText(result) {
    const text = String(result?.data?.text || '');
    const base = typeof baseOcr?.menuOcrScore === 'function' ? baseOcr.menuOcrScore(text) : text.length;
    return base + Math.max(0, Number(result?.data?.confidence || 0)) * 2;
  }

  async function recognizePasses(original, binary) {
    const worker = await createWorker(), passes = [];
    try {
      const jobs = [
        { canvas:binary, psm:'6', name:'binary-psm6' },
        { canvas:binary, psm:'11', name:'binary-psm11' },
        { canvas:binary, psm:'4', name:'binary-psm4' },
        { canvas:original, psm:'6', name:'original-psm6' }
      ];
      for (const job of jobs) {
        await worker.setParameters({ tessedit_pageseg_mode:job.psm, preserve_interword_spaces:'1', user_defined_dpi:'220' });
        const result = await worker.recognize(job.canvas, {}, { text:true, blocks:true });
        passes.push({ name:job.name, text:String(result?.data?.text || ''), blocks:result?.data?.blocks || [], confidence:Number(result?.data?.confidence || 0), score:scoreText(result) });
      }
    } finally { await worker.terminate().catch(() => {}); }
    return passes.sort((a,b) => b.score - a.score);
  }

  async function categoryAnchors(binary) {
    if (!layout?.detectCategoryAnchorsFromRotatedBlocks) return [];
    const worker = await createWorker();
    try {
      await worker.setParameters({ tessedit_pageseg_mode:'11', preserve_interword_spaces:'1', user_defined_dpi:'220' });
      const result = await worker.recognize(rotateClockwise(binary), {}, { text:true, blocks:true });
      const anchors = layout.detectCategoryAnchorsFromRotatedBlocks(result?.data?.blocks || [], binary.height);
      return anchors.length >= 3 ? anchors : [];
    } finally { await worker.terminate().catch(() => {}); }
  }

  function passRows(pass, width, height, anchors) {
    const rows = [];
    if (layout?.parseBlocks && pass.blocks?.length) rows.push(...layout.parseBlocks(pass.blocks, width, height, anchors));
    if (typeof baseOcr?.parseMenuText === 'function') rows.push(...baseOcr.parseMenuText(pass.text, { baseConfidence:Math.max(.5, Math.min(.98, pass.confidence / 100)) }));
    const seen = new Set();
    return rows.filter((row) => {
      const id = `${strict?.key?.(row.category) || row.category}|${strict?.key?.(row.subcategory) || row.subcategory}|${Number(row.price || 0)}`;
      if (seen.has(id)) return false; seen.add(id); return true;
    });
  }

  async function analyzeCanvas(canvas) {
    const binary = highContrastCanvas(canvas), passes = await recognizePasses(canvas, binary), anchors = await categoryAnchors(binary).catch(() => []);
    const rowsByPass = passes.map((pass) => passRows(pass, binary.width, binary.height, anchors));
    const candidates = [...(rowsByPass[0] || []), ...(rowsByPass[1] || [])];
    const filtered = strict?.filterRows ? strict.filterRows(candidates, rowsByPass, sessionCurrency()) : candidates;
    if (!filtered.length) throw new Error('La carta se pudo leer, pero no encontramos suficientes productos seguros. Prueba con una imagen más nítida o una captura directa del archivo original.');
    return { items:filtered, engine:'tesseract:binary-consensus-v4', mode:'BINARY_CONSENSUS', passes:passes.length, threshold:Number(binary.dataset.ocrThreshold || 0), anchors:anchors.length, bestPass:passes[0]?.name || null };
  }

  async function analyzeImage(blob) { return analyzeCanvas(await sourceCanvas(blob)); }

  async function analyzePdf(blob) {
    await loadScript(PDFJS_URL, () => Boolean(window.pdfjsLib?.getDocument)); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    const pdf = await window.pdfjsLib.getDocument({ data:new Uint8Array(await blob.arrayBuffer()) }).promise;
    const pages = Math.min(Number(pdf.numPages || 0), MAX_PDF_PAGES);
    let textLayer = '';
    for (let i=1;i<=pages;i+=1) { const page=await pdf.getPage(i), content=await page.getTextContent(); textLayer += content.items.map((item)=>`${item.str || ''}${item.hasEOL?'\n':' '}`).join('') + '\n'; }
    if (typeof baseOcr?.parseMenuText === 'function') {
      const textRows = baseOcr.parseMenuText(textLayer, { baseConfidence:.97 });
      const safe = strict?.filterRows ? strict.filterRows(textRows, [], sessionCurrency(), { trustedText:true }) : textRows;
      if (safe.length >= 2) return { items:safe, engine:'pdf:text-layer', mode:'PDF_TEXT', passes:0, threshold:0, anchors:0, bestPass:'text-layer' };
    }
    const all = [];
    for (let i=1;i<=pages;i+=1) {
      const page=await pdf.getPage(i), base=page.getViewport({scale:1}), scale=Math.max(2, Math.min(4, 4200/Math.max(base.width,base.height))), viewport=page.getViewport({scale});
      const canvas=document.createElement('canvas'); canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height); const ctx=canvas.getContext('2d',{alpha:false}); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); await page.render({canvasContext:ctx,viewport}).promise;
      const result=await analyzeCanvas(canvas); all.push(...result.items);
    }
    const safe = strict?.filterRows ? strict.filterRows(all, [all, all], sessionCurrency(), { trustedText:true }) : all;
    return { items:safe, engine:'pdf:binary-consensus-v4', mode:'PDF_BINARY', passes:pages*4, threshold:0, anchors:0, bestPass:'per-page' };
  }

  function base64Blob(payload) {
    const raw=atob(String(payload.dataBase64 || '')), bytes=new Uint8Array(raw.length); for (let i=0;i<raw.length;i+=1) bytes[i]=raw.charCodeAt(i); return new Blob([bytes], { type:payload.mimeType || 'application/octet-stream' });
  }

  async function browserAnalyze(payload) {
    const blob=base64Blob(payload); if (blob.size > MAX_BYTES) throw new Error('La carta supera el máximo de 5 MB.');
    const result=payload.mimeType === 'application/pdf' ? await analyzePdf(blob) : await analyzeImage(blob);
    return { fileName:payload.fileName || 'carta', mimeType:payload.mimeType, bytes:blob.size, provider:'BROWSER_OCR', marker:'VANTIX_BROWSER_OCR_V1', qualityMarker:'VANTIX_BROWSER_OCR_MULTIPASS_V2', layoutMarker:'VANTIX_MENU_OCR_LAYOUT_V3', preprocessMarker:MARKER, strictMarker:strict?.MARKER || 'VANTIX_MENU_OCR_STRICT_V4', engine:result.engine, recognitionMode:result.mode, recognitionPasses:result.passes, threshold:result.threshold, categoryAnchors:result.anchors, bestPass:result.bestPass, items:result.items };
  }

  window.fetch = async (input, init = {}) => {
    const path=pathOf(input);
    if (path === STATUS_PATH) {
      try {
        const response=await priorFetch(input,init), body=await response.clone().json().catch(()=>null), provider=String(body?.data?.provider || '');
        if (response.ok && body?.data?.configured && provider && provider !== 'BROWSER_OCR') { enabled=false; return response; }
      } catch {}
      enabled=true;
      return jsonResponse({ ok:true, data:{ configured:true, provider:'BROWSER_OCR', marker:'VANTIX_BROWSER_OCR_V1', qualityMarker:'VANTIX_BROWSER_OCR_MULTIPASS_V2', layoutMarker:'VANTIX_MENU_OCR_LAYOUT_V3', preprocessMarker:MARKER, strictMarker:strict?.MARKER || 'VANTIX_MENU_OCR_STRICT_V4', maxBytes:MAX_BYTES, acceptedMimeTypes:['application/pdf','image/jpeg','image/png','image/webp'], preserveOriginalImage:true, multipass:true, layoutAware:true, highContrastPreprocess:true, consensus:true, strictValidation:true, note:'OCR V4 de alta precisión listo' } });
    }
    if (path === ANALYZE_PATH && enabled) {
      try { return jsonResponse({ ok:true, data:await browserAnalyze(JSON.parse(String(init?.body || '{}'))) }); }
      catch (error) { return jsonResponse({ ok:false, error:{ code:'RESTAURANT_MENU_BROWSER_OCR_V4_ERROR', message:error?.message || 'No fue posible reconocer la carta' } }, 502); }
    }
    return priorFetch(input,init);
  };

  window.VantixGCRestaurantBrowserOcrV4 = { marker:MARKER, highContrastCanvas, otsuThreshold };
})();
