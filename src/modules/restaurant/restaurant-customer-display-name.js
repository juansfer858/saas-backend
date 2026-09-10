'use strict';

const CUSTOMER_NAME_TAG = '[RESTAURANTE_CLIENTE]';
const DEFAULT_CUSTOMER_NAME = 'Cliente genérico';

function normalizeCustomerName(value) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return clean || DEFAULT_CUSTOMER_NAME;
}

function stripCustomerNameTag(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith(CUSTOMER_NAME_TAG))
    .join('\n')
    .trim();
}

function mergeCustomerNameObservation(value, customerName) {
  const base = stripCustomerNameTag(value);
  const name = normalizeCustomerName(customerName);
  if (name === DEFAULT_CUSTOMER_NAME) return base || null;
  return [base, `${CUSTOMER_NAME_TAG} ${name}`].filter(Boolean).join('\n');
}

function customerNameFromObservations(value) {
  const line = String(value ?? '')
    .split(/\r?\n/)
    .find((row) => row.trim().startsWith(CUSTOMER_NAME_TAG));
  if (!line) return DEFAULT_CUSTOMER_NAME;
  return normalizeCustomerName(line.trim().slice(CUSTOMER_NAME_TAG.length));
}

module.exports = {
  CUSTOMER_NAME_TAG,
  DEFAULT_CUSTOMER_NAME,
  normalizeCustomerName,
  stripCustomerNameTag,
  mergeCustomerNameObservation,
  customerNameFromObservations
};
