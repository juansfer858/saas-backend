'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const MARKER = 'VANTIX_EDGE_WORKSPACE_PC_WAITER_V59';
const target = require.resolve('./workspace-entry');
let source = fs.readFileSync(target, 'utf8');

// Conserva la corrección V28: después de responder un redirect local no se debe
// continuar ejecutando el handler y responder una segunda vez.
const originalRedirect = `function redirect(res, location, headers = {}) {\n  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });\n  res.end();\n}`;
const fixedRedirect = `function redirect(res, location, headers = {}) {\n  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });\n  res.end();\n  return true;\n}`;
if (!source.includes(originalRedirect)) throw new Error(`${MARKER}_V28_REDIRECT_TARGET_MISSING`);
source = source.replace(originalRedirect, fixedRedirect);

// Esta función no se ejecuta en Node. Se serializa con toString() y reemplaza sólo
// renderWaiter() dentro del HTML local, dejando Mesas/KDS/Caja y sus APIs intactas.
function workspacePcWaiterRenderV59() {
  /* VANTIX_EDGE_WORKSPACE_PC_WAITER_V59 */
  const tables = state.restaurant.tables || [];
  const menu = (state.restaurant.menu || []).filter((x) => x.available !== false);
  if (!selectedTable || !tables.some((x) => x.id === selectedTable)) {
    selectedTable = tables.find((x) => x.activeSession)?.id || tables[0]?.id || null;
  }
  const selected = tables.find((x) => x.id === selectedTable) || null;
  $('#title').textContent = 'Mesero';

  if (!can('PEDIDOS.CREAR')) {
    $('#view').innerHTML = '<div class="card"><div class="section-head"><h2>Tomar pedido</h2></div><div class="empty"><b>Este usuario no tiene permiso para tomar pedidos.</b><div class="muted">Solicita el permiso PEDIDOS.CREAR desde Administración.</div></div></div>';
    return;
  }

  const options = tables.map((table) => {
    const meta = table.activeSession ? String(table.state || 'OCUPADA').replaceAll('_', ' ') : 'LIBRE';
    return `<option value="${table.id}" ${table.id === selectedTable ? 'selected' : ''}>${esc(table.name)} · ${esc(meta)} · ${money(tableBill(table.id))}</option>`;
  }).join('');

  let body = '';
  if (!selected) {
    body = '<div class="empty"><b>No hay mesas configuradas.</b><div class="muted">Crea o sincroniza las mesas de esta sede.</div></div>';
  } else if (!selected.activeSession) {
    const action = can('MESAS.CREAR')
      ? `<button class="btn primary" onclick="openTable('${selected.id}')">Abrir mesa y tomar pedido</button>`
      : '<span class="muted">Tu usuario puede tomar pedidos, pero no tiene permiso para abrir esta mesa.</span>';
    body = `<div class="empty"><b>${esc(selected.name)} está libre.</b><div class="muted">Puedes abrirla desde aquí sin salir del panel Mesero.</div><div class="actions" style="justify-content:center">${action}</div></div>`;
  } else if (!menu.length) {
    body = '<div class="empty"><b>La carta local aún no tiene productos sincronizados.</b><div class="muted">La mesa está abierta; sincroniza la sede para traer la carta.</div><div class="actions" style="justify-content:center"><button class="btn" onclick="document.getElementById(\'sync\')?.click()">Sincronizar carta</button></div></div>';
  } else {
    body = `<div class="menu">${menu.map((item) => `<div class="menu-item"><small>${esc(item.category)} · ${esc(item.station)}</small><b>${esc(item.product?.nombre || 'Producto')}</b><strong>${money(item.product?.precio1)}</strong><div class="qty"><input type="number" min="0" step="1" value="0" data-menu="${item.id}"></div></div>`).join('')}</div><div class="actions"><button class="btn primary" id="sendOrder">Enviar pedido</button></div>`;
  }

  $('#view').innerHTML = `<div class="card"><div class="section-head"><h2>Tomar pedido</h2>${tables.length ? `<select id="waiterTable" class="select push">${options}</select>` : ''}</div>${body}</div>`;
  $('#waiterTable')?.addEventListener('change', (event) => {
    selectedTable = event.target.value;
    workspacePcWaiterRenderV59();
  });
  $('#sendOrder')?.addEventListener('click', sendOrder);
}

function patchWorkspaceHtmlV59(html) {
  if (html.includes(MARKER)) return html;
  const start = html.indexOf('function renderWaiter(){');
  const end = html.indexOf('async function sendOrder()', start);
  if (start < 0 || end < 0) throw new Error(`${MARKER}_HTML_RENDER_WAITER_TARGET_MISSING`);
  const replacement = workspacePcWaiterRenderV59
    .toString()
    .replace('workspacePcWaiterRenderV59', 'renderWaiter')
    .replaceAll('workspacePcWaiterRenderV59()', 'renderWaiter()');
  const patched = `${html.slice(0, start)}${replacement}${html.slice(end)}`;
  if (!patched.includes(MARKER) || !patched.includes('Abrir mesa y tomar pedido') || !patched.includes('Sincronizar carta')) {
    throw new Error(`${MARKER}_HTML_PATCH_FAILED`);
  }
  return patched;
}

const workspaceHtmlNeedle = "const WORKSPACE_HTML = fs.readFileSync(path.join(__dirname, '..', 'workspace', 'public', 'index.html'), 'utf8');";
const workspaceHtmlReplacement = `${patchWorkspaceHtmlV59.toString()}\n\nconst WORKSPACE_HTML = patchWorkspaceHtmlV59(fs.readFileSync(path.join(__dirname, '..', 'workspace', 'public', 'index.html'), 'utf8'));`;
if (!source.includes(workspaceHtmlNeedle)) throw new Error(`${MARKER}_WORKSPACE_HTML_TARGET_MISSING`);
source = source.replace(workspaceHtmlNeedle, workspaceHtmlReplacement);

if (!source.includes('return true;\n}\n\nasync function readJson') || !source.includes('patchWorkspaceHtmlV59')) {
  throw new Error(`${MARKER}_SOURCE_PATCH_NOT_APPLIED`);
}

const patched = new Module(target, module.parent);
patched.filename = target;
patched.paths = Module._nodeModulePaths(path.dirname(target));
require.cache[target] = patched;
patched._compile(source, target);

module.exports = patched.exports;
