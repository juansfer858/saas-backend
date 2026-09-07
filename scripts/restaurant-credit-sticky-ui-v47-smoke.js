'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const paymentChain = require('../src/modules/restaurant/restaurant-payment-chain-v43.public.routes');

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    contains(value) { return values.has(value); },
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    toggle(value, force) {
      if (force === true) values.add(value);
      else if (force === false) values.delete(value);
      else if (values.has(value)) values.delete(value);
      else values.add(value);
      return values.has(value);
    }
  };
}

function makeMethod(method, active = false) {
  return {
    dataset: { cashMethod: method },
    disabled: false,
    title: '',
    classList: makeClassList(active ? ['active'] : []),
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    closest(selector) { return selector === '[data-cash-method]' ? this : null; }
  };
}

async function main() {
  const listeners = {};
  const timers = [];
  const cash = makeMethod('EFECTIVO', true);
  const bank = makeMethod('BANCO');
  const credit = makeMethod('CREDITO');
  const methods = [cash, bank, credit];
  const panel = { dataset: {} };
  const account = { value: '', innerHTML: '' };
  const accountLabel = { hidden:false, classList:makeClassList(), childNodes:[{ textContent:'Caja / banco' }] };
  const received = { hidden:false };
  const confirm = {
    disabled:false,
    dataset:{},
    title:'',
    setAttribute() {},
    removeAttribute(name) { if (name === 'title') this.title = ''; }
  };
  const tip = { value:'0', disabled:false, title:'', removeAttribute(name) { if (name === 'title') this.title = ''; } };
  const customer = { id:'customer-1', nombre:'Cliente Uno', identificacion:'101010', activo:true, tipo:'CLIENTE', diasPlazo:15, cupoCredito:50000 };
  const help = { textContent:'' };
  const customerSelect = {
    value:'',
    innerHTML:'',
    closest(selector) { return selector === '#creditCustomer' ? this : null; }
  };
  const creditField = {
    hidden:true,
    querySelector(selector) {
      if (selector === '#creditCustomer') return customerSelect;
      if (selector === '#creditCustomerHelp') return help;
      return null;
    }
  };

  const document = {
    readyState:'loading',
    documentElement:{ dataset:{} },
    querySelector(selector) {
      if (selector === '#view .cash-fast-panel.cash-collect-dialog-v40' || selector === '#view .cash-fast-panel') return panel;
      if (selector === '#paymentAccount') return account;
      if (selector === '#accountLabel') return accountLabel;
      if (selector === '#cashReceivedRow') return received;
      if (selector === '#closeTable') return confirm;
      if (selector === '#tip') return tip;
      if (selector === '#creditCustomerField') return creditField;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-cash-method]') return methods;
      return [];
    },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    createElement() { throw new Error('No debe crear DOM adicional en este smoke'); }
  };

  const window = {
    fetch: async (url) => {
      if (String(url).startsWith('/api/v1/terceros')) {
        return { ok:true, status:200, json:async()=>({ ok:true, data:[customer] }) };
      }
      if (String(url).startsWith('/api/v1/tesoreria/cajas-bancos')) {
        return { ok:true, status:200, json:async()=>({ ok:true, data:[] }) };
      }
      return { ok:true, status:200, json:async()=>({ ok:true, data:{} }) };
    },
    addEventListener() {}
  };

  const localStorage = {
    getItem(key) {
      if (key === 'vantixgc_core_session_v1') return JSON.stringify({ token:'qa-token', subdomain:'qa' });
      return null;
    }
  };

  vm.runInNewContext(paymentChain.runtime, {
    window,
    document,
    localStorage,
    console,
    Intl,
    JSON,
    String,
    Number,
    Array,
    Object,
    Set,
    Promise,
    queueMicrotask,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    alert() {}
  }, { filename:'restaurant-payment-chain-v43.runtime.js' });

  const click = listeners.click?.[0];
  const change = listeners.change?.[0];
  assert.ok(click, 'runtime debe registrar click autoritativo');
  assert.ok(change, 'runtime debe registrar change autoritativo');

  let creditClickStopped = false;
  click({
    target:credit,
    preventDefault() {},
    stopImmediatePropagation() { creditClickStopped = true; }
  });
  assert.equal(creditClickStopped, true, 'Crédito debe aislar su click de capas antiguas');
  assert.equal(panel.dataset.paymentMethodAuthoritative, 'CREDITO');
  assert.equal(credit.classList.contains('active'), true);
  assert.equal(cash.classList.contains('active'), false);

  customerSelect.value = customer.id;
  let customerChangeStopped = false;
  change({
    target:customerSelect,
    stopImmediatePropagation() { customerChangeStopped = true; }
  });
  assert.equal(customerChangeStopped, true, 'seleccionar cliente debe aislar el change de capas que puedan volver a Efectivo');
  assert.equal(panel.dataset.paymentMethodAuthoritative, 'CREDITO');
  assert.equal(credit.classList.contains('active'), true);
  assert.equal(cash.classList.contains('active'), false);
  assert.equal(confirm.disabled, false, 'cliente seleccionado debe habilitar confirmar crédito');

  const pending = [...timers];
  timers.length = 0;
  pending.forEach((fn) => fn());
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(panel.dataset.paymentMethodAuthoritative, 'CREDITO', 'los reintentos de estabilización no pueden volver a Efectivo');
  assert.equal(credit.classList.contains('active'), true);
  assert.equal(cash.classList.contains('active'), false);
  assert.equal(customerSelect.value, customer.id, 'el cliente elegido debe sobrevivir la resincronización');

  console.log('RESTAURANT CREDIT STICKY UI V47 SMOKE OK');
  console.log(JSON.stringify({
    creditClickIsolated:true,
    customerChangeIsolated:true,
    creditRemainsAuthoritative:true,
    customerSelectionSurvivesSync:true,
    noFallbackToCash:true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
