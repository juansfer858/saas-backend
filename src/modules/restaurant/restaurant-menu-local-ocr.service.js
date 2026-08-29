'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const { AppError } = require('../../utils/app-error');
const parser = require('./restaurant-menu-local-parser');

const execFileAsync = promisify(execFile);
const MAX_PDF_PAGES = Math.min(Math.max(Number(process.env.RESTAURANT_MENU_OCR_MAX_PDF_PAGES) || 8, 1), 12);
const TIMEOUT_MS = Math.max(Number(process.env.RESTAURANT_MENU_OCR_LOCAL_TIMEOUT_MS) || 90000, 15000);
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
let cachedCapabilities = null;
let cachedAt = 0;

function commandExists(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 2500 });
  return !result.error;
}

function runtimeCapabilities(force = false) {
  if (!force && cachedCapabilities && Date.now() - cachedAt < 60000) return cachedCapabilities;
  const tesseract = commandExists('tesseract', ['--version']);
  const pdftotext = commandExists('pdftotext', ['-v']);
  const pdftoppm = commandExists('pdftoppm', ['-v']);
  cachedCapabilities = {
    tesseract,
    pdftotext,
    pdftoppm,
    imageOcr: tesseract,
    pdfText: pdftotext,
    pdfScan: tesseract && pdftoppm,
    maxPdfPages: MAX_PDF_PAGES
  };
  cachedAt = Date.now();
  return cachedCapabilities;
}

function providerStatus(maxBytes) {
  const capabilities = runtimeCapabilities();
  const configured = capabilities.imageOcr || capabilities.pdfText;
  return {
    configured,
    provider: configured ? 'LOCAL_OCR' : 'NONE',
    model: configured ? 'Tesseract + Poppler' : null,
    maxBytes,
    capabilities
  };
}

function decodeFile(input, maxBytes) {
  const fileName = parser.cleanText(input?.fileName || 'carta', 120) || 'carta';
  const mimeType = parser.cleanText(input?.mimeType, 80).toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new AppError(400, 'Formato no compatible. Usa PDF, JPG, PNG o WEBP.', 'RESTAURANT_MENU_OCR_FILE_TYPE');
  const raw = String(input?.dataBase64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new AppError(400, 'Archivo OCR inválido', 'RESTAURANT_MENU_OCR_FILE_INVALID');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw new AppError(400, 'El archivo está vacío', 'RESTAURANT_MENU_OCR_FILE_EMPTY');
  if (buffer.length > maxBytes) throw new AppError(413, `La carta supera el máximo de ${Math.floor(maxBytes / 1024 / 1024)} MB`, 'RESTAURANT_MENU_OCR_FILE_TOO_LARGE');
  return { fileName, mimeType, buffer, bytes: buffer.length };
}

async function run(command, args) {
  try {
    const result = await execFileAsync(command, args, { encoding: 'utf8', windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES });
    return String(result.stdout || '');
  } catch (error) {
    const detail = parser.cleanText(error?.stderr || error?.message || '', 280);
    throw new AppError(502, `El OCR local no pudo procesar el archivo${detail ? `: ${detail}` : ''}`, 'RESTAURANT_MENU_LOCAL_OCR_ERROR');
  }
}

async function ocrImage(imagePath) {
  let lastError = null;
  for (const language of ['spa+eng', 'spa', 'eng']) {
    try {
      return await run('tesseract', [imagePath, 'stdout', '-l', language, '--psm', '6']);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function scanPdf(pdfPath, tempDir) {
  const prefix = path.join(tempDir, 'page');
  await run('pdftoppm', ['-f', '1', '-l', String(MAX_PDF_PAGES), '-r', '190', '-jpeg', pdfPath, prefix]);
  const files = (await fs.readdir(tempDir))
    .filter((name) => /^page-\d+\.jpg$/i.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));
  const chunks = [];
  for (const file of files) chunks.push(await ocrImage(path.join(tempDir, file)));
  return chunks.join('\n');
}

function extensionFor(mimeType) {
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}

async function analyzeDocument(input, maxBytes) {
  const status = providerStatus(maxBytes);
  if (!status.configured) throw new AppError(503, 'El OCR local no está disponible en este servidor', 'RESTAURANT_MENU_LOCAL_OCR_NOT_AVAILABLE');
  const file = decodeFile(input, maxBytes);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vantix-menu-ocr-'));
  const filePath = path.join(tempDir, `carta${extensionFor(file.mimeType)}`);
  let items = [];
  let mode = '';
  try {
    await fs.writeFile(filePath, file.buffer);
    if (file.mimeType === 'application/pdf') {
      if (status.capabilities.pdfText) {
        const text = await run('pdftotext', ['-f', '1', '-l', String(MAX_PDF_PAGES), '-layout', filePath, '-']);
        items = parser.parseMenuText(text);
        if (items.length) mode = 'PDF_TEXT';
      }
      if (!items.length && status.capabilities.pdfScan) {
        items = parser.parseMenuText(await scanPdf(filePath, tempDir));
        if (items.length) mode = 'PDF_SCAN';
      }
    } else {
      if (!status.capabilities.imageOcr) throw new AppError(503, 'El lector local de imágenes no está disponible', 'RESTAURANT_MENU_LOCAL_IMAGE_NOT_AVAILABLE');
      items = parser.parseMenuText(await ocrImage(filePath));
      if (items.length) mode = 'IMAGE_OCR';
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
  if (!items.length) throw new AppError(422, 'No se encontraron productos con nombre y precio suficientemente claros. Prueba con una foto más recta y nítida.', 'RESTAURANT_MENU_OCR_NO_ITEMS');
  return { fileName: file.fileName, mimeType: file.mimeType, bytes: file.bytes, provider: 'LOCAL_OCR', mode, items };
}

module.exports = { MAX_PDF_PAGES, providerStatus, runtimeCapabilities, analyzeDocument };
