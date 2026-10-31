'use strict';

const AUTO_SKU_PREFIX = 'PROD-';
const AUTO_SKU_WIDTH = 6;
const AUTO_SKU_RE = /^PROD-(\d+)$/i;

function parseAutoSku(value) {
  const match = AUTO_SKU_RE.exec(String(value || '').trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function formatAutoSku(sequence) {
  const n = Math.max(1, Number(sequence) || 1);
  return AUTO_SKU_PREFIX + String(n).padStart(AUTO_SKU_WIDTH, '0');
}

function nextAutoSku(existingSkus = [], totalProducts = 0) {
  let maxAuto = 0;
  for (const value of existingSkus) {
    const n = parseAutoSku(value);
    if (n && n > maxAuto) maxAuto = n;
  }
  const byCount = Math.max(1, Number(totalProducts || 0) + 1);
  return formatAutoSku(Math.max(byCount, maxAuto + 1));
}

module.exports = {
  AUTO_SKU_PREFIX,
  AUTO_SKU_WIDTH,
  parseAutoSku,
  formatAutoSku,
  nextAutoSku
};
