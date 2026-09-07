'use strict';

const MARKER = 'VANTIX_RESTAURANT_ACCOUNT_ATTENTION_V58';
const HEADER_VALUE = 'v58-account-attention';

function requiredReplace(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`${MARKER}_${label}_TARGET_NOT_FOUND`);
  return source.replace(needle, replacement);
}

function patchOperatorSource(source) {
  let out = String(source || '');
  if (!out || out.includes(MARKER)) return out;

  const helperNeedle = "  function tablesInSelectedZone() { return S.tables.filter((table) => table.zoneId === S.selectedZoneId); }";
  const helperReplacement = [
    helperNeedle,
    '',
    `  const ${MARKER}_OPERATOR = true;`,
    '  let accountAttentionBusy = false;',
    "  function accountAttentionActive(table) { return Boolean(table?.activeSession && (String(table.state || '') === 'CUENTA_PEDIDA' || table.activeSession.accountRequestedAt)); }",
    '  function ensureAccountAttentionStyles() {',
    "    if (document.getElementById('restaurantAccountAttentionV58Styles')) return;",
    "    const style = document.createElement('style');",
    "    style.id = 'restaurantAccountAttentionV58Styles';",
    "    style.textContent = '@keyframes vantixAccountAttentionPulse{0%,100%{background:#fff0dc;border-color:#f97316;box-shadow:0 0 0 2px rgba(249,115,22,.28),0 12px 28px rgba(249,115,22,.22)}50%{background:#ffe0dd;border-color:#dc2626;box-shadow:0 0 0 4px rgba(220,38,38,.34),0 16px 36px rgba(220,38,38,.30)}}.salon-table.ACCOUNT_ATTENTION,.salon-list-row.ACCOUNT_ATTENTION,.waiter-table-chip.ACCOUNT_ATTENTION{animation:vantixAccountAttentionPulse 1.05s ease-in-out infinite!important;border-width:3px!important;border-style:solid!important}.salon-table.ACCOUNT_ATTENTION .salon-table-state,.salon-list-row.ACCOUNT_ATTENTION .salon-table-state,.waiter-table-chip.ACCOUNT_ATTENTION span{color:#991b1b!important;font-weight:1000!important}#restaurantAccountAttentionDock{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:2147482000;display:grid;gap:8px;width:min(330px,calc(100vw - 32px));max-height:60vh;overflow:auto}#restaurantAccountAttentionDock button{min-height:58px;padding:10px 16px;border:2px solid #b91c1c;border-radius:16px;background:linear-gradient(135deg,#f97316,#dc2626);color:#fff;font:900 15px/1.2 inherit;letter-spacing:.02em;box-shadow:0 14px 34px rgba(185,28,28,.34);cursor:pointer;animation:vantixAccountAttentionButton 1.05s ease-in-out infinite}#restaurantAccountAttentionDock button small{display:block;margin-top:3px;font-size:11px;font-weight:750;opacity:.9}@keyframes vantixAccountAttentionButton{50%{transform:scale(1.035);box-shadow:0 18px 42px rgba(220,38,38,.46)}}@media(max-width:640px){#restaurantAccountAttentionDock{bottom:max(76px,env(safe-area-inset-bottom));right:10px;width:calc(100vw - 20px)}#restaurantAccountAttentionDock button{min-height:54px}}@media(prefers-reduced-motion:reduce){.salon-table.ACCOUNT_ATTENTION,.salon-list-row.ACCOUNT_ATTENTION,.waiter-table-chip.ACCOUNT_ATTENTION,#restaurantAccountAttentionDock button{animation:none!important}.salon-table.ACCOUNT_ATTENTION,.salon-list-row.ACCOUNT_ATTENTION,.waiter-table-chip.ACCOUNT_ATTENTION{background:#fff0dc!important;border-color:#dc2626!important}}';",
    '    document.head.appendChild(style);',
    '  }',
    '  function renderAccountAttentionDock(rows = S.tables) {',
    '    ensureAccountAttentionStyles();',
    "    let dock = document.getElementById('restaurantAccountAttentionDock');",
    "    const canCharge = can('RESTAURANTE.CERRAR') && can('TESORERIA.CERRAR');",
    '    const pending = (Array.isArray(rows) ? rows : []).filter(accountAttentionActive);',
    '    if (!canCharge || !pending.length) { dock?.remove(); return; }',
    "    if (!dock) { dock = document.createElement('aside'); dock.id = 'restaurantAccountAttentionDock'; dock.setAttribute('aria-label','Mesas pendientes de cobro'); document.body.appendChild(dock); }",
    "    dock.innerHTML = pending.map((table) => '<button type=\"button\" data-account-charge=\"' + esc(table.id) + '\">COBRAR ' + esc(String(table.name || table.code || 'MESA').toUpperCase()) + '<small>Cuenta solicitada · abrir Caja</small></button>').join('');",
    "    dock.querySelectorAll('[data-account-charge]').forEach((button) => button.addEventListener('click', () => {",
    '      const table = pending.find((row) => row.id === button.dataset.accountCharge);',
    '      if (!table) return;',
    '      S.selectedTableId = table.id;',
    '      if (table.zoneId) S.selectedZoneId = table.zoneId;',
    "      setTab('caja').catch((error) => message(error.message, true));",
    '    }));',
    '  }',
    '  async function refreshAccountAttentionDock() {',
    "    if (accountAttentionBusy || !(can('RESTAURANTE.CERRAR') && can('TESORERIA.CERRAR'))) return;",
    '    accountAttentionBusy = true;',
    "    try { const rows = await api('/api/v1/restaurante/mesas'); renderAccountAttentionDock(rows); } catch {} finally { accountAttentionBusy = false; }",
    '  }',
    '  function accountAttentionRealtimeRelevant(detail) {',
    '    const topics = Array.isArray(detail?.topics) ? detail.topics : [];',
    "    return topics.some((topic) => topic === 'treasury' || topic.startsWith('restaurant'));",
    '  }',
    '  function accountAttentionRealtimeKick(detail) {',
    '    if (!accountAttentionRealtimeRelevant(detail)) return;',
    '    refreshAccountAttentionDock().catch(() => {});',
    '  }',
    '  function startAccountAttentionRealtime() {',
    '    ensureAccountAttentionStyles();',
    "    if (!(can('RESTAURANTE.CERRAR') && can('TESORERIA.CERRAR'))) return;",
    '    refreshAccountAttentionDock().catch(() => {});',
    "    window.addEventListener('vantix:tenant-realtime', (event) => accountAttentionRealtimeKick(event.detail || {}));",
    "    window.addEventListener('vantix:tenant-realtime-ready', () => accountAttentionRealtimeKick({ topics:['restaurant','treasury'] }));",
    '  }'
  ].join('\n');
  out = requiredReplace(out, helperNeedle, helperReplacement, 'OP_HELPERS');

  out = requiredReplace(
    out,
    "    return { total:rows.length, free:count('LIBRE'), occupied:count('OCUPADA'), bill:count('CUENTA_PEDIDA'), reserved:count('RESERVADA') };",
    "    return { total:rows.length, free:count('LIBRE'), occupied:count('OCUPADA'), bill:rows.filter(accountAttentionActive).length, reserved:count('RESERVADA') };",
    'OP_STATS'
  );
  out = requiredReplace(
    out,
    "    return `<article class=\"salon-table ${table.state} ${edit ? 'edit-mode' : ''}\" data-table=\"${table.id}\"",
    "    return `<article class=\"salon-table ${table.state} ${accountAttentionActive(table) ? 'ACCOUNT_ATTENTION' : ''} ${edit ? 'edit-mode' : ''}\" data-table=\"${table.id}\"",
    'OP_TABLE_CLASS'
  );
  out = requiredReplace(
    out,
    '<span class="salon-table-state">${esc(salonStateLabel(table.state))}</span>',
    '<span class="salon-table-state">${esc(accountAttentionActive(table) ? \'CUENTA SOLICITADA\' : salonStateLabel(table.state))}</span>',
    'OP_TABLE_LABEL'
  );
  out = requiredReplace(
    out,
    "    return `<article class=\"salon-list-row ${table.state}\"><div class=\"salon-list-main\"><span class=\"salon-table-state\">${esc(salonStateLabel(table.state))}</span>",
    "    return `<article class=\"salon-list-row ${table.state} ${accountAttentionActive(table) ? 'ACCOUNT_ATTENTION' : ''}\"><div class=\"salon-list-main\"><span class=\"salon-table-state\">${esc(accountAttentionActive(table) ? 'CUENTA SOLICITADA' : salonStateLabel(table.state))}</span>",
    'OP_LIST_ATTENTION'
  );
  out = requiredReplace(
    out,
    '    const people = Number(table.activeSession?.guestCount || 0);\n    const meta = state === \'LIBRE\' ? \'Libre\' : state === \'CUENTA_PEDIDA\' ? \'Cuenta pedida\' : `${state.replaceAll(\'_\',\' \')}${people ? ` · ${people} pers.` : \'\'}`;',
    '    const people = Number(table.activeSession?.guestCount || 0);\n    const attention = accountAttentionActive(table);\n    const meta = attention ? \'CUENTA SOLICITADA\' : state === \'LIBRE\' ? \'Libre\' : `${state.replaceAll(\'_\',\' \')}${people ? ` · ${people} pers.` : \'\'}`;',
    'OP_WAITER_META'
  );
  out = requiredReplace(
    out,
    'class="waiter-table-chip ${selected ? \'selected\' : \'\'} ${state}"',
    'class="waiter-table-chip ${selected ? \'selected\' : \'\'} ${state} ${attention ? \'ACCOUNT_ATTENTION\' : \'\'}"',
    'OP_WAITER_CLASS'
  );
  out = requiredReplace(
    out,
    "  window.addEventListener('beforeunload', stopPoll);\n  loadContext().then(renderCurrent).catch((error) => message(error.message, true));",
    "  window.addEventListener('beforeunload', stopPoll);\n  loadContext().then(async () => { startAccountAttentionRealtime(); await renderCurrent(); }).catch((error) => message(error.message, true));",
    'OP_START'
  );

  return `/* ${MARKER} · Centro/Mesero · cuenta solicitada visible */\n${out}`;
}

function patchDedicatedWaiterSource(source) {
  let out = String(source || '');
  if (!out || out.includes(MARKER)) return out;

  const stateNeedle = "  function tableMeta(table) {\n    const state = String(table?.state || 'LIBRE');";
  const stateReplacement = [
    `  const ${MARKER}_WAITER = true;`,
    "  function accountAttentionActive(table) { return Boolean(table?.activeSession && (String(table.state || '') === 'CUENTA_PEDIDA' || table.activeSession.accountRequestedAt)); }",
    '  function ensureAccountAttentionStyles() {',
    "    if (document.getElementById('restaurantWaiterAccountAttentionV58Styles')) return;",
    "    const style = document.createElement('style');",
    "    style.id = 'restaurantWaiterAccountAttentionV58Styles';",
    "    style.textContent = '@keyframes wvAccountAttentionPulse{0%,100%{background:#fff0dc;border-color:#f97316;box-shadow:0 0 0 2px rgba(249,115,22,.25)}50%{background:#ffe0dd;border-color:#dc2626;box-shadow:0 0 0 4px rgba(220,38,38,.32)}}.wv-table.ACCOUNT_ATTENTION{animation:wvAccountAttentionPulse 1.05s ease-in-out infinite!important;border:3px solid #dc2626!important}.wv-table.ACCOUNT_ATTENTION span{color:#991b1b!important;font-weight:1000!important}@media(prefers-reduced-motion:reduce){.wv-table.ACCOUNT_ATTENTION{animation:none!important;background:#fff0dc!important}}';",
    '    document.head.appendChild(style);',
    '  }',
    '  function tableMeta(table) {',
    "    const state = String(table?.state || 'LIBRE');"
  ].join('\n');
  out = requiredReplace(out, stateNeedle, stateReplacement, 'WAITER_HELPERS');
  out = requiredReplace(
    out,
    "    if (state === 'LIBRE') return 'Libre';\n    if (state === 'CUENTA_PEDIDA') return 'Cuenta pedida';",
    "    if (accountAttentionActive(table)) return 'CUENTA SOLICITADA';\n    if (state === 'LIBRE') return 'Libre';",
    'WAITER_META'
  );
  out = requiredReplace(
    out,
    "      row.activeSession?.billingMode || '', row.activeSession?.sale?.total || 0",
    "      row.activeSession?.billingMode || '', row.activeSession?.sale?.total || 0, row.activeSession?.accountRequestedAt || ''",
    'WAITER_FINGERPRINT'
  );
  out = requiredReplace(
    out,
    "    root.innerHTML = rows.length\n      ? rows.map((table) => `<button type=\"button\" class=\"wv-table ${esc(String(table.state || 'LIBRE'))} ${table.id === S.selectedTableId ? 'active' : ''}\"",
    "    ensureAccountAttentionStyles();\n    root.innerHTML = rows.length\n      ? rows.map((table) => `<button type=\"button\" class=\"wv-table ${esc(String(table.state || 'LIBRE'))} ${accountAttentionActive(table) ? 'ACCOUNT_ATTENTION' : ''} ${table.id === S.selectedTableId ? 'active' : ''}\"",
    'WAITER_TABLE_CLASS'
  );

  return `/* ${MARKER} · Tablet Mesero · cuenta solicitada visible */\n${out}`;
}

function patchAsset(pathname, source) {
  if (pathname === '/app/restaurant-ui.js') return patchOperatorSource(source);
  if (pathname === '/app/restaurant-waiter-runtime-v7.js') return patchDedicatedWaiterSource(source);
  return source;
}

function installRestaurantAccountAttentionV58(req, res, next) {
  if (req.method !== 'GET' || !['/app/restaurant-ui.js', '/app/restaurant-waiter-runtime-v7.js'].includes(req.path)) return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const patched = patchAsset(req.path, source);
      if (patched !== source) body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      res.set('X-VantixGC-Account-Attention', HEADER_VALUE);
    }
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, HEADER_VALUE, patchOperatorSource, patchDedicatedWaiterSource, patchAsset, installRestaurantAccountAttentionV58 };
