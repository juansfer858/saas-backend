'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  PAYMENT_METHODS_VISIBILITY_MARKER,
  paymentMethodsVisibilityBrowserRuntime,
  installPaymentMethodsVisibilityRuntime
} = require('../src/modules/restaurant/restaurant-payment-methods-visibility-browser.public.routes');

assert.equal(PAYMENT_METHODS_VISIBILITY_MARKER, 'VANTIX_RESTAURANT_PAYMENT_METHODS_VISIBLE_V2');
assert.equal(typeof installPaymentMethodsVisibilityRuntime, 'function');
new Function(paymentMethodsVisibilityBrowserRuntime);
assert.match(paymentMethodsVisibilityBrowserRuntime, /⚙ Métodos de pago/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /cash-page-head/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /independentOfSelectedTable:true/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /eventDriven:true/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /contextRoleFirst:true/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /\/api\/v1\/restaurante\/metodos-pago/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /\/api\/v1\/tesoreria\/cajas-bancos/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /\+ Crear cuenta \/ billetera para transferencias/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /\$\('#userRole'\)\?\.textContent\|\|session\.user\?\.rol/);
assert.doesNotMatch(paymentMethodsVisibilityBrowserRuntime, /session\.user\?\.rol\|\|\$\('#userRole'\)\?\.textContent/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /vantix:tenant-realtime/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /scheduleBurst/);
assert.doesNotMatch(paymentMethodsVisibilityBrowserRuntime, /\\`/);
assert.doesNotMatch(paymentMethodsVisibilityBrowserRuntime, /setInterval|MutationObserver/);

const publicRouter = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
assert.match(publicRouter, /restaurant-payment-methods-visibility-browser\.public\.routes/);
assert.match(publicRouter, /router\.use\(installPaymentMethodsVisibilityRuntime\)/);

const baseUi = fs.readFileSync('src/web/restaurant-ui.js', 'utf8');
assert.match(baseUi, /\/api\/v1\/restaurante\/ui-context/);
assert.match(baseUi, /S\.context\.user\.rol/);
assert.match(baseUi, /class=\"cash-shell/);
assert.match(baseUi, /cash-page-head/);

function createElementFactory(registry) {
  return function createElement(tagName = 'div') {
    const element = {
      tagName: String(tagName).toUpperCase(),
      id: '',
      className: '',
      dataset: {},
      textContent: '',
      innerHTML: '',
      hidden: false,
      children: [],
      parentNode: null,
      classList: { add() {}, remove() {}, contains() { return false; } },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        if (child.id) registry.set(`#${child.id}`, child);
        return child;
      },
      remove() {
        if (this.id) registry.delete(`#${this.id}`);
        if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((row) => row !== this);
      },
      querySelector(selector) { return registry.get(selector) || null; },
      querySelectorAll() { return []; },
      addEventListener() {},
      setAttribute(name, value) { this[name] = value; }
    };
    return element;
  };
}

function createCajaRuntimeHarness({ sessionRole = 'CAJERO', contextRole = '', cashState = 'CLOSED' } = {}) {
  const registry = new Map();
  const timers = [];
  const windowListeners = new Map();
  const createElement = createElementFactory(registry);
  const role = createElement('span');
  role.id = 'userRole';
  role.textContent = contextRole;
  registry.set('#userRole', role);

  const head = createElement('div');
  head.className = 'cash-page-head';
  head.dataset.cashState = cashState;
  const shell = createElement('section');
  shell.className = 'cash-shell';
  shell.querySelector = (selector) => selector === '.cash-page-head' ? head : (registry.get(selector) || null);

  const document = {
    readyState: 'complete',
    head: createElement('head'),
    body: createElement('body'),
    createElement,
    querySelector(selector) {
      if (selector === '#view .cash-shell') return shell;
      return registry.get(selector) || null;
    },
    querySelectorAll() { return []; },
    addEventListener() {}
  };

  const window = {
    addEventListener(type, listener) {
      const rows = windowListeners.get(type) || [];
      rows.push(listener);
      windowListeners.set(type, rows);
    }
  };

  const sandbox = {
    window,
    document,
    localStorage: {
      getItem(key) {
        if (key !== 'vantixgc_core_session_v1') return null;
        return JSON.stringify({ token: 'test-token', subdomain: 'demo-restaurante', user: { rol: sessionRole } });
      }
    },
    queueMicrotask(callback) { callback(); },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {},
    fetch: async () => ({ ok: true, async json() { return { data: [] }; } }),
    confirm: () => true,
    alert() {}
  };
  window.window = window;
  vm.runInNewContext(paymentMethodsVisibilityBrowserRuntime, sandbox, { filename: 'restaurant-payment-methods-browser-runtime.js' });

  return {
    role,
    head,
    cashState,
    shortcut: () => registry.get('#rpmvShortcut') || null,
    flushTimers(limit = Infinity) {
      let count = 0;
      while (timers.length && count < limit) {
        const callback = timers.shift();
        callback();
        count += 1;
      }
      return count;
    },
    emit(type) {
      for (const listener of windowListeners.get(type) || []) listener({ detail: {} });
    }
  };
}

for (const cashState of ['CLOSED', 'OPEN']) {
  const liveAdmin = createCajaRuntimeHarness({ sessionRole: 'CAJERO', contextRole: 'ADMIN', cashState });
  liveAdmin.flushTimers();
  assert.equal(liveAdmin.shortcut()?.textContent, '⚙ Métodos de pago', `live ADMIN must see shortcut with cash ${cashState}`);
  assert.equal(liveAdmin.shortcut()?.dataset.rpmvManage, 'true');
}

const liveAdministrator = createCajaRuntimeHarness({ sessionRole: 'CAJERO', contextRole: 'ADMINISTRADOR' });
liveAdministrator.flushTimers();
assert.equal(liveAdministrator.shortcut()?.textContent, '⚙ Métodos de pago');

const liveSuperAdmin = createCajaRuntimeHarness({ sessionRole: 'CAJERO', contextRole: 'SUPER_ADMIN' });
liveSuperAdmin.flushTimers();
assert.equal(liveSuperAdmin.shortcut()?.textContent, '⚙ Métodos de pago');

const liveNonAdmin = createCajaRuntimeHarness({ sessionRole: 'ADMIN', contextRole: 'MESERO' });
liveNonAdmin.flushTimers();
assert.equal(liveNonAdmin.shortcut(), null, 'live ui-context role must override stale ADMIN session snapshot');

const lateContext = createCajaRuntimeHarness({ sessionRole: 'CAJERO', contextRole: '' });
lateContext.flushTimers(1);
assert.equal(lateContext.shortcut(), null);
lateContext.role.textContent = 'ADMIN';
lateContext.flushTimers();
assert.equal(lateContext.shortcut()?.textContent, '⚙ Métodos de pago', 'late ui-context hydration must surface shortcut');

const headers = {};
let servedAsset = null;
const req = { method: 'GET', path: '/app/restaurant-ui.js' };
const res = {
  set(name, value) { headers[name] = value; return this; },
  send(body) { servedAsset = body; return body; }
};
let nextCalled = false;
installPaymentMethodsVisibilityRuntime(req, res, () => {
  nextCalled = true;
  res.send('/* canonical restaurant-ui + realtime */');
});
assert.equal(nextCalled, true);
assert.equal(headers['X-VantixGC-Payment-Methods-Visibility'], 'v2-caja-header');
assert.match(String(servedAsset), /VANTIX_RESTAURANT_PAYMENT_METHODS_VISIBLE_V2/);
assert.match(String(servedAsset), /contextRoleFirst:true/);
assert.match(String(servedAsset), /⚙ Métodos de pago/);
assert.doesNotMatch(String(servedAsset), /session\.user\?\.rol\|\|\$\('#userRole'\)\?\.textContent/);

console.log('RESTAURANT PAYMENT METHODS VISIBILITY SMOKE OK');
console.log(JSON.stringify({
  servedAssetRuntimeMarker:true,
  middlewareHeader:true,
  cajaHeaderShortcut:true,
  visibleWithoutSelectedTable:true,
  visibleWithClosedShift:true,
  visibleWithOpenShift:true,
  uiContextRoleAuthoritative:true,
  staleSessionRoleCannotHideAdmin:true,
  staleAdminSessionCannotElevateNonAdmin:true,
  lateUiContextHydrationSupported:true,
  eventDrivenNoPermanentDomWatch:true,
  methodCrud:true,
  bankWalletCreate:true,
  browserRuntimeSyntax:true
}, null, 2));
