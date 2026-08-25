const fs = require('node:fs');

function replaceOnce(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Missing patch anchor: ${label}`);
  return source.replace(needle, replacement);
}

const appPath = 'src/app.js';
let app = fs.readFileSync(appPath, 'utf8');

app = replaceOnce(
  app,
  "const SIDEBAR_STABILITY_VERSION = 'tenant-card-server-slot-v1';",
  "const SIDEBAR_STABILITY_VERSION = 'tenant-card-server-slot-v1';\nconst TENANT_SHELL_VERSION = 'core-shell-v1';",
  'shell version'
);

const workspaceTag = 'const superCoreWorkspaceHeadTag = `<link rel="stylesheet" href="/app/super-core-workspace-v6.css?v=core-workspace-v6-static"><script>document.documentElement.dataset.superCoreWorkspace="super-core-workspace-v6";</script>`;';
const canonicalExpressionLiteral = '${window.VantixGCCoreShell?.topbarHtml?.() || ""}';
const shellBootstrap = `<script id="core-shell-bootstrap">(()=>{const key='vantixgc_core_session_v1';const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));const userName=()=>{const s=read();return s?.user?.nombre||s?.user?.email||'Usuario'};const userRole=()=>{const s=read();return s?.user?.rol||''};const initial=()=>{const n=userName().trim();return (n[0]||'U').toUpperCase()};const topbarHtml=()=>{const tenantName=window.VantixGCTenantIdentity?.nameHtml?.()||'';const tenantMeta=window.VantixGCTenantIdentity?.metaHtml?.()||'';const name=esc(userName());const role=esc(userRole());const avatar=esc(initial());return '<header class="topbar core-shell-topbar" data-core-shell-topbar="v1"><div class="core-shell-tenant"><button type="button" class="btn small core-shell-menu" id="coreMenuToggle" data-core-shell-menu aria-label="Abrir menú">☰</button><div class="tenant core-shell-tenant-copy"><strong>'+tenantName+'</strong><small>'+tenantMeta+'</small></div></div><div class="userbox core-shell-user"><div class="core-shell-user-copy"><strong>'+name+'</strong><div class="core-shell-role">'+role+'</div></div><div class="avatar core-shell-avatar" aria-hidden="true">'+avatar+'</div><button type="button" class="btn small core-shell-logout" id="logout">Salir</button></div></header>'};window.VantixGCCoreShell=Object.freeze({topbarHtml});document.addEventListener('click',e=>{const trigger=e.target.closest?.('[data-core-shell-menu]');if(!trigger)return;document.getElementById('sidebar')?.classList.toggle('open')})})();</script>`;
const shellTag = 'const canonicalShellHeadTag = `' + shellBootstrap + '`;\nconst canonicalTenantTopbarExpression = \'' + canonicalExpressionLiteral + '\';';
app = replaceOnce(app, workspaceTag, `${workspaceTag}\n${shellTag}`, 'canonical shell bootstrap');

const sidebarFn = `function replaceLegacyTenantSidebar(html, requestPath) {\n  const sidebarPattern = /<aside class=(['"])(?:sidebar|side)\\1[^>]*>[\\s\\S]*?<\\/aside>/g;\n  return html.replace(sidebarPattern, (_match, _quote, offset) => {\n    const before = html.slice(0, offset);\n    const insideScript = before.lastIndexOf('<script') > before.lastIndexOf('</script>');\n    return canonicalTenantSidebarHtml(requestPath, { dynamicTenant: insideScript });\n  });\n}`;
const topbarFn = `${sidebarFn}\n\nfunction replaceLegacyTenantTopbar(html) {\n  const topbarPattern = /<header class=(['"])(?:topbar|top)\\1[^>]*>[\\s\\S]*?<\\/header>/g;\n  return html.replace(topbarPattern, (match, _quote, offset) => {\n    const before = html.slice(0, offset);\n    const insideScript = before.lastIndexOf('<script') > before.lastIndexOf('</script>');\n    return insideScript ? canonicalTenantTopbarExpression : match;\n  });\n}`;
app = replaceOnce(app, sidebarFn, topbarFn, 'topbar canonicalizer');

app = replaceOnce(
  app,
  "async function sendTenantHtml(filePath, req, res, next, bodyTags = [], headTags = [tenantNavigationHeadTag, superCoreWorkspaceHeadTag]) {",
  "async function sendTenantHtml(filePath, req, res, next, bodyTags = [], headTags = [tenantNavigationHeadTag, superCoreWorkspaceHeadTag, canonicalShellHeadTag]) {",
  'head tag defaults'
);

app = replaceOnce(
  app,
  "    const canonicalized = replaceLegacyTenantSidebar(html, req.path);\n    const withHead = injectBeforeHeadEnd(canonicalized, headTags);",
  "    const canonicalizedSidebar = replaceLegacyTenantSidebar(html, req.path);\n    const canonicalized = replaceLegacyTenantTopbar(canonicalizedSidebar);\n    const withHead = injectBeforeHeadEnd(canonicalized, headTags);",
  'topbar replacement in response'
);

app = replaceOnce(
  app,
  "    res.set('X-VantixGC-Sidebar-Stability', SIDEBAR_STABILITY_VERSION);",
  "    res.set('X-VantixGC-Sidebar-Stability', SIDEBAR_STABILITY_VERSION);\n    res.set('X-VantixGC-Tenant-Shell', TENANT_SHELL_VERSION);",
  'shell response header'
);

fs.writeFileSync(appPath, app);

const cssPath = 'src/web/super-core-workspace-v6.css';
let css = fs.readFileSync(cssPath, 'utf8');
css += `\n/* Super Core canonical shell V1 */\n.app{grid-template-columns:250px minmax(0,1fr)!important}\n.core-shell-topbar{height:72px!important;background:#fff!important;border-bottom:1px solid #e9edf2!important;display:flex!important;align-items:center!important;justify-content:space-between!important;padding:0 24px!important;position:sticky!important;top:0!important;z-index:10!important;box-shadow:0 1px 0 rgba(15,23,42,.02)!important}\n.core-shell-tenant{display:flex!important;align-items:center!important;gap:12px!important;min-width:0!important}.core-shell-tenant-copy{min-width:0!important}.core-shell-tenant-copy strong{display:block!important;color:#111827!important;font-size:13px!important;font-weight:750!important;line-height:1.15!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}.core-shell-tenant-copy small{display:block!important;margin-top:3px!important;color:#7b8794!important;font-size:11px!important;font-weight:500!important;line-height:1.1!important}\n.core-shell-user{display:flex!important;align-items:center!important;gap:10px!important}.core-shell-user-copy{text-align:right!important;line-height:1.1!important}.core-shell-user-copy strong{display:block!important;color:#1f2937!important;font-size:13px!important;font-weight:700!important;white-space:nowrap!important}.core-shell-role{margin-top:3px!important;color:#7b8794!important;font-size:10px!important;font-weight:600!important}.core-shell-avatar{width:32px!important;height:32px!important;min-width:32px!important;border-radius:50%!important;background:#eff6ff!important;color:#2563eb!important;border:1px solid #dbeafe!important;display:grid!important;place-items:center!important;font-size:12px!important;font-weight:800!important}.core-shell-logout{min-height:32px!important;padding:6px 10px!important}.core-shell-menu{display:none!important}\n.pagehead,.head{display:flex!important;justify-content:space-between!important;gap:16px!important;align-items:center!important;margin-bottom:24px!important}.pagehead h1,.head h1{margin:0 0 5px!important;font-size:28px!important;line-height:1.1!important;letter-spacing:-.025em!important;color:#111827!important;font-weight:750!important}.pagehead p,.head .muted{margin-top:0!important;color:#667085!important;line-height:1.45!important}\n@media(max-width:760px){.app{display:block!important}.core-shell-topbar{height:64px!important;padding:0 13px!important}.core-shell-menu{display:inline-flex!important}.core-shell-user-copy{display:none!important}.pagehead,.head{align-items:flex-start!important;flex-direction:column!important}.pagehead h1,.head h1{font-size:24px!important}}\n`;
fs.writeFileSync(cssPath, css);

const panelSmokePath = 'scripts/panel-ui-smoke.js';
let panelSmoke = fs.readFileSync(panelSmokePath, 'utf8');
const sharedEntryAnchor = "    const sharedEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');\n";
const shellChecks = `    const shellRoutes = ['/app/dashboard','/app/ventas','/app/compras','/app/inventario','/app/tesoreria','/app/cartera','/app/terceros','/app/contabilidad','/app/configuracion','/app/configuracion-avanzada'];\n    for (const route of shellRoutes) {\n      const response = await fetch(base + route);\n      const html = await response.text();\n      assert.equal(response.status, 200, route);\n      assert.equal(response.headers.get('x-vantixgc-tenant-shell'), 'core-shell-v1', route);\n      assert.match(html, /id=\\"core-shell-bootstrap\\"/, route);\n      assert.match(html, /data-core-shell-topbar=\\"v1\\"/, route);\n      assert.match(html, /window\\.VantixGCCoreShell\\?\\.topbarHtml/, route);\n      assert.ok(!html.includes('<header class=\\"top\\">'), route + ': no debe conservar top legacy');\n      assert.ok(!html.includes('<header class=\\"topbar\\">'), route + ': no debe conservar topbar legacy');\n    }\n    assert.match(workspaceCss, /\\.app\\{grid-template-columns:250px minmax\\(0,1fr\\)!important\\}/);\n    assert.match(workspaceCss, /\\.core-shell-topbar\\{/);\n    assert.match(workspaceCss, /\\.core-shell-user-copy\\{/);\n    assert.match(workspaceCss, /\\.pagehead,\\.head\\{/);\n\n`;
panelSmoke = replaceOnce(panelSmoke, sharedEntryAnchor, shellChecks + sharedEntryAnchor, 'panel smoke canonical shell checks');
fs.writeFileSync(panelSmokePath, panelSmoke);

console.log('CANONICAL SUPER CORE SHELL PATCH APPLIED');
