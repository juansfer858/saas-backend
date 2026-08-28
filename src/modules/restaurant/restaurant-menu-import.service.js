'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const MAX_FILE_BYTES = Math.min(Math.max(Number(process.env.RESTAURANT_MENU_OCR_MAX_BYTES) || 5 * 1024 * 1024, 512 * 1024), 6 * 1024 * 1024);
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MENU_CATEGORIES = new Set(['ENTRADAS', 'FUERTES', 'BEBIDAS', 'POSTRES']);
const STATIONS = new Set(['COCINA', 'BARRA', 'POSTRES']);
const CATEGORY_DESCRIPTION_PREFIX = 'Categoría de carta: ';

const OCR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      maxItems: 300,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string' },
          subcategory: { type: 'string' },
          price: { type: 'number' },
          operationalCategory: { type: 'string', enum: ['ENTRADAS', 'FUERTES', 'BEBIDAS', 'POSTRES'] },
          station: { type: 'string', enum: ['COCINA', 'BARRA', 'POSTRES'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        },
        required: ['category', 'subcategory', 'price', 'operationalCategory', 'station', 'confidence']
      }
    }
  },
  required: ['items']
};

const OCR_PROMPT = `Analiza esta carta de restaurante y devuelve únicamente los productos que tengan un precio explícito visible.

Objetivo de clasificación:
- category: la familia o encabezado comercial del producto. Ejemplos: HAMBURGUESAS, PERROS, PIZZAS, JUGOS, CERVEZAS, POSTRES.
- subcategory: el nombre concreto, sabor o variante que compra el cliente. Ejemplo: si el encabezado es HAMBURGUESAS y aparece RANCHERA $25.000, category debe ser "Hamburguesas" y subcategory debe ser "Ranchera".
- price: número normalizado, sin símbolo de moneda ni separadores de miles. Ejemplo $25.000 => 25000.
- operationalCategory: ENTRADAS, FUERTES, BEBIDAS o POSTRES según el tipo de producto.
- station: COCINA para comida, BARRA para bebidas y POSTRES para postres.
- confidence: confianza entre 0 y 1.

Reglas estrictas:
1. No inventes productos ni precios.
2. Si un precio no se puede asociar con seguridad a un producto, omite esa línea.
3. No extraigas teléfonos, direcciones, promociones generales, horarios ni textos decorativos.
4. Si un producto tiene tamaños con precios distintos, crea una fila por variante y agrega el tamaño al subcategory.
5. Conserva nombres comerciales en español y corrige sólo errores OCR evidentes.
6. No necesitamos imágenes ni descripciones del plato, sólo categoría, nombre/variante y precio.`;

function cleanText(value, max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizedKey(value) {
  return cleanText(value, 180).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function inferOperationalCategory(category, subcategory) {
  const value = `${normalizedKey(category)} ${normalizedKey(subcategory)}`;
  if (/(BEBIDA|JUGO|GASEOSA|SODA|AGUA|CAFE|CAFÉ|CERVEZA|VINO|COCTEL|LIMONADA|MALTEADA|TE |TÉ )/.test(value)) return 'BEBIDAS';
  if (/(POSTRE|HELADO|TORTA|PASTEL|BROWNIE|FLAN|TIRAMISU|TIRAMISÚ|DULCE)/.test(value)) return 'POSTRES';
  if (/(ENTRADA|PICADA|NACHO|EMPANADA|AREPA|PAN DE AJO|ALITAS)/.test(value)) return 'ENTRADAS';
  return 'FUERTES';
}

function stationFor(category) {
  if (category === 'BEBIDAS') return 'BARRA';
  if (category === 'POSTRES') return 'POSTRES';
  return 'COCINA';
}

function normalizePrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function normalizeItems(items) {
  const seen = new Set();
  const rows = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const category = cleanText(raw?.category, 80);
    const subcategory = cleanText(raw?.subcategory, 180);
    const price = normalizePrice(raw?.price);
    if (!category || !subcategory || !(price > 0)) continue;
    let operationalCategory = String(raw?.operationalCategory || '').toUpperCase();
    if (!MENU_CATEGORIES.has(operationalCategory)) operationalCategory = inferOperationalCategory(category, subcategory);
    let station = String(raw?.station || '').toUpperCase();
    if (!STATIONS.has(station)) station = stationFor(operationalCategory);
    const confidenceNumber = Number(raw?.confidence);
    const confidence = Number.isFinite(confidenceNumber) ? Math.max(0, Math.min(1, confidenceNumber)) : 0.75;
    const key = `${normalizedKey(category)}|${normalizedKey(subcategory)}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ category, subcategory, price, operationalCategory, station, confidence });
    if (rows.length >= 300) break;
  }
  return rows;
}

function providerStatus() {
  const customEndpoint = String(process.env.RESTAURANT_MENU_OCR_ENDPOINT || '').trim();
  const openAiKey = String(process.env.RESTAURANT_MENU_OCR_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const model = String(process.env.RESTAURANT_MENU_OCR_MODEL || 'gpt-5.6-luna').trim();
  if (customEndpoint) return { configured: true, provider: 'CUSTOM_HTTP', model: null, maxBytes: MAX_FILE_BYTES };
  if (openAiKey) return { configured: true, provider: 'OPENAI', model, maxBytes: MAX_FILE_BYTES };
  return { configured: false, provider: 'NONE', model, maxBytes: MAX_FILE_BYTES };
}

function decodeFile(input) {
  const fileName = cleanText(input?.fileName || 'carta', 120) || 'carta';
  const mimeType = cleanText(input?.mimeType, 80).toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new AppError(400, 'Formato no compatible. Usa PDF, JPG, PNG o WEBP.', 'RESTAURANT_MENU_OCR_FILE_TYPE');
  }
  const raw = String(input?.dataBase64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new AppError(400, 'Archivo OCR inválido', 'RESTAURANT_MENU_OCR_FILE_INVALID');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw new AppError(400, 'El archivo está vacío', 'RESTAURANT_MENU_OCR_FILE_EMPTY');
  if (buffer.length > MAX_FILE_BYTES) throw new AppError(413, `La carta supera el máximo de ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB`, 'RESTAURANT_MENU_OCR_FILE_TOO_LARGE');
  return { fileName, mimeType, dataBase64: raw, bytes: buffer.length };
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function parseJsonText(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch {
    throw new AppError(502, 'El proveedor OCR respondió en un formato no reconocido', 'RESTAURANT_MENU_OCR_BAD_RESPONSE');
  }
}

async function callOpenAi(file) {
  const key = String(process.env.RESTAURANT_MENU_OCR_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  if (!key) throw new AppError(503, 'El proveedor OCR aún no está configurado', 'RESTAURANT_MENU_OCR_NOT_CONFIGURED');
  const model = String(process.env.RESTAURANT_MENU_OCR_MODEL || 'gpt-5.6-luna').trim();
  const documentPart = file.mimeType === 'application/pdf'
    ? { type: 'input_file', filename: file.fileName, file_data: `data:${file.mimeType};base64,${file.dataBase64}` }
    : { type: 'input_image', image_url: `data:${file.mimeType};base64,${file.dataBase64}`, detail: 'high' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(Number(process.env.RESTAURANT_MENU_OCR_TIMEOUT_MS) || 90000, 15000));
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: [{ role: 'user', content: [documentPart, { type: 'input_text', text: OCR_PROMPT }] }],
        text: { format: { type: 'json_schema', name: 'restaurant_menu_ocr', strict: true, schema: OCR_SCHEMA } },
        max_output_tokens: 8000
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = cleanText(payload?.error?.message || `HTTP ${response.status}`, 300);
      throw new AppError(502, `No fue posible reconocer la carta: ${message}`, 'RESTAURANT_MENU_OCR_PROVIDER_ERROR');
    }
    return parseJsonText(extractResponseText(payload));
  } catch (error) {
    if (error?.name === 'AbortError') throw new AppError(504, 'El reconocimiento OCR tardó demasiado', 'RESTAURANT_MENU_OCR_TIMEOUT');
    throw error;
  } finally { clearTimeout(timer); }
}

async function callCustomProvider(file) {
  const endpoint = String(process.env.RESTAURANT_MENU_OCR_ENDPOINT || '').trim();
  if (!endpoint) throw new AppError(503, 'El proveedor OCR aún no está configurado', 'RESTAURANT_MENU_OCR_NOT_CONFIGURED');
  const key = String(process.env.RESTAURANT_MENU_OCR_API_KEY || '').trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(Number(process.env.RESTAURANT_MENU_OCR_TIMEOUT_MS) || 90000, 15000));
  try {
    const response = await fetch(endpoint, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ fileName: file.fileName, mimeType: file.mimeType, dataBase64: file.dataBase64, task: 'restaurant_menu', prompt: OCR_PROMPT })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new AppError(502, cleanText(payload?.message || `El proveedor OCR respondió HTTP ${response.status}`, 300), 'RESTAURANT_MENU_OCR_PROVIDER_ERROR');
    return payload?.data || payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new AppError(504, 'El reconocimiento OCR tardó demasiado', 'RESTAURANT_MENU_OCR_TIMEOUT');
    throw error;
  } finally { clearTimeout(timer); }
}

async function analyzeDocument(input) {
  const status = providerStatus();
  if (!status.configured) throw new AppError(503, 'El importador está instalado, pero falta configurar el proveedor OCR', 'RESTAURANT_MENU_OCR_NOT_CONFIGURED');
  const file = decodeFile(input);
  const payload = status.provider === 'CUSTOM_HTTP' ? await callCustomProvider(file) : await callOpenAi(file);
  const items = normalizeItems(payload?.items);
  if (!items.length) throw new AppError(422, 'No se encontraron productos con nombre y precio suficientemente claros', 'RESTAURANT_MENU_OCR_NO_ITEMS');
  return { fileName: file.fileName, mimeType: file.mimeType, bytes: file.bytes, provider: status.provider, items };
}

function menuSku(category, subcategory) {
  const key = `${normalizedKey(category)}|${normalizedKey(subcategory)}`;
  return `MENU-OCR-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16).toUpperCase()}`;
}

function categoryDescription(category) {
  return `${CATEGORY_DESCRIPTION_PREFIX}${cleanText(category, 80)}`;
}

function publicCategoryFromDescription(description, fallback) {
  const value = String(description || '').trim();
  if (value.toLowerCase().startsWith(CATEGORY_DESCRIPTION_PREFIX.toLowerCase())) {
    return cleanText(value.slice(CATEGORY_DESCRIPTION_PREFIX.length), 80) || fallback;
  }
  return fallback;
}

async function confirmImport(tenantId, userId, input) {
  const items = normalizeItems(input?.items);
  if (!items.length) throw new AppError(400, 'No hay productos válidos para importar', 'RESTAURANT_MENU_IMPORT_EMPTY');
  const fileName = cleanText(input?.fileName || 'carta', 120);
  return prisma.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    const imported = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const sku = menuSku(item.category, item.subcategory);
      let product = await tx.producto.findUnique({ where: { tenantId_sku: { tenantId, sku } } });
      if (product) {
        product = await tx.producto.update({
          where: { id: product.id },
          data: { nombre: item.subcategory, descripcion: categoryDescription(item.category), precio1: item.price, activo: true }
        });
        updated += 1;
      } else {
        product = await tx.producto.create({
          data: {
            tenantId,
            tipo: 'PRODUCTO',
            sku,
            nombre: item.subcategory,
            descripcion: categoryDescription(item.category),
            unidadMedida: 'UND',
            controlaInventario: false,
            costoPromedio: 0,
            stockActual: 0,
            precio1: item.price,
            ivaPct: 0,
            impoconsumoPct: 0,
            activo: true
          }
        });
        created += 1;
      }
      const existingMenu = await tx.restaurantMenuItem.findUnique({ where: { tenantId_productId: { tenantId, productId: product.id } } });
      const menuItem = existingMenu
        ? await tx.restaurantMenuItem.update({
          where: { id: existingMenu.id },
          data: { category: item.operationalCategory, station: item.station, requiresRecipe: false, active: true, sortOrder: index }
        })
        : await tx.restaurantMenuItem.create({
          data: { tenantId, productId: product.id, category: item.operationalCategory, station: item.station, requiresRecipe: false, active: true, sortOrder: index }
        });
      imported.push({ menuItemId: menuItem.id, productId: product.id, sku, category: item.category, subcategory: item.subcategory, price: item.price });
    }
    if (userId) {
      await tx.auditoriaContable.create({
        data: {
          tenantId,
          userId,
          entidad: 'RESTAURANT_MENU_OCR_IMPORT',
          entidadId: tenantId,
          accion: 'IMPORT',
          metadata: { fileName, itemCount: imported.length, created, updated, skus: imported.map((row) => row.sku) }
        }
      });
    }
    return { created, updated, total: imported.length, items: imported };
  });
}

async function listCarta(tenantId) {
  const menu = await prisma.restaurantMenuItem.findMany({ where: { tenantId, active: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { creadoEn: 'asc' }] });
  const productIds = menu.map((row) => row.productId);
  const products = productIds.length ? await prisma.producto.findMany({ where: { tenantId, id: { in: productIds }, activo: true } }) : [];
  const byId = new Map(products.map((row) => [row.id, row]));
  return menu.map((row) => {
    const product = byId.get(row.productId);
    if (!product) return null;
    const fallback = row.category === 'BEBIDAS' ? 'Bebidas' : row.category === 'POSTRES' ? 'Postres' : row.category === 'ENTRADAS' ? 'Entradas' : 'Fuertes';
    return {
      id: row.id,
      productId: product.id,
      category: publicCategoryFromDescription(product.descripcion, fallback),
      subcategory: product.nombre,
      price: Number(product.precio1 || 0),
      operationalCategory: row.category,
      station: row.station,
      importedByOcr: String(product.sku || '').startsWith('MENU-OCR-')
    };
  }).filter(Boolean);
}

module.exports = {
  MAX_FILE_BYTES,
  ALLOWED_MIME_TYPES,
  normalizeItems,
  providerStatus,
  analyzeDocument,
  confirmImport,
  listCarta,
  menuSku,
  publicCategoryFromDescription
};
