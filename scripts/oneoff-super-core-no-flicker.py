from pathlib import Path

app = Path('src/app.js')
s = app.read_text()

needle = "const panelRestaurantEntryPath = path.join(__dirname, 'web', 'panel-restaurant-entry.js');\n"
replacement = needle + "const superCoreWorkspaceCssPath = path.join(__dirname, 'web', 'super-core-workspace-v6.css');\n"
assert needle in s and 'superCoreWorkspaceCssPath' not in s
s = s.replace(needle, replacement, 1)

final_sidebar = '''
/* Final sidebar colors are server-rendered before first paint. No runtime visual patching. */
.core-v5-tenant{background:linear-gradient(180deg,rgba(252,253,254,.72),rgba(235,240,243,.64))!important;border-color:rgba(255,255,255,.40)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.30),0 8px 18px rgba(20,24,27,.12)!important}
.core-v5-tenant b{color:#17212b!important;font-weight:700!important}.core-v5-tenant span{color:#46515a!important;font-weight:500!important}
.core-tenant-sidebar .nav a{background:rgba(250,252,253,.72)!important;color:#17212b!important;border-color:rgba(255,255,255,.38)!important;font-weight:600!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.25)!important}
.core-tenant-sidebar .nav a:hover{background:rgba(255,255,255,.86)!important;color:#17212b!important;border-color:rgba(255,255,255,.52)!important}
.core-tenant-sidebar .nav a.active{background:linear-gradient(90deg,rgba(210,237,229,.92),rgba(250,252,253,.84))!important;color:#17212b!important;border-color:rgba(255,255,255,.54)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.38),0 7px 16px rgba(20,24,27,.12)!important}
.core-tenant-sidebar .nav a .icon{color:#17212b!important}
.core-tenant-sidebar .nav a.core-v5-primary-vertical{background:linear-gradient(135deg,rgba(252,253,254,.84),rgba(235,240,243,.74))!important;color:#17212b!important;border-color:rgba(255,255,255,.52)!important}
.core-tenant-sidebar .nav a.core-v5-primary-vertical.active{background:linear-gradient(90deg,rgba(210,237,229,.95),rgba(250,252,253,.86))!important;color:#17212b!important}
.core-tenant-sidebar .nav a.core-v5-primary-vertical .icon{color:#17212b!important;background:rgba(19,122,83,.14)!important}
.core-v5-primary-copy strong{color:#17212b!important;font-weight:700!important}.core-v5-primary-copy small{color:#46515a!important;font-weight:600!important}
.core-tenant-sidebar .brand,.core-tenant-sidebar .brand small,.core-tenant-sidebar .nav-title,.core-v5-group-label{color:#f7f9fa!important}
'''
media = '\n@media(max-width:760px){.core-tenant-sidebar{position:fixed!important;'
assert media in s
s = s.replace(media, final_sidebar + media, 1)

navtag = 'const tenantNavigationTag = `<script src="/app/panel-restaurant-entry.js?v=${TENANT_NAV_VERSION}"></script>`;'
assert navtag in s
headtag = 'const superCoreWorkspaceHeadTag = `<link rel="stylesheet" href="/app/super-core-workspace-v6.css?v=core-workspace-v6-static"><script>document.documentElement.dataset.superCoreWorkspace="super-core-workspace-v6";</script>`;\n'
s = s.replace(navtag, headtag + navtag, 1)

old_default = 'async function sendTenantHtml(filePath, req, res, next, bodyTags = [], headTags = [tenantNavigationHeadTag]) {'
new_default = 'async function sendTenantHtml(filePath, req, res, next, bodyTags = [], headTags = [tenantNavigationHeadTag, superCoreWorkspaceHeadTag]) {'
assert old_default in s
s = s.replace(old_default, new_default, 1)

route_anchor = "app.get('/app/panel-restaurant-entry.js', (_req, res) => {\n  res.set('Cache-Control', 'no-store');\n  res.type('application/javascript').sendFile(panelRestaurantEntryPath);\n});\n"
assert route_anchor in s
css_route = "app.get('/app/super-core-workspace-v6.css', (_req, res) => {\n  res.set('Cache-Control', 'public, max-age=300');\n  res.type('text/css').sendFile(superCoreWorkspaceCssPath);\n});\n\n"
s = s.replace(route_anchor, css_route + route_anchor, 1)
app.write_text(s)

entry = Path('src/web/panel-restaurant-entry.js')
e = entry.read_text()
start = e.index('  function installWorkspaceTheme() {')
marker = '\n\n  function readSession() {'
end = e.index(marker, start)
e = e[:start] + '  document.documentElement.dataset.superCoreWorkspace = WORKSPACE_THEME;' + e[end:]
e = e.replace('\n  installWorkspaceTheme();\n', '\n')
assert 'installWorkspaceTheme' not in e
assert 'insertAdjacentHTML' not in e
assert 'super-core-workspace-v6-style' not in e
entry.write_text(e)

test = Path('scripts/panel-ui-smoke.js')
t = test.read_text()
loop_anchor = "    const salesResponse = await fetch(base + '/app/ventas');\n"
assert loop_anchor in t
checks = '''    assert.match(canonicalHtml, /\\/app\\/super-core-workspace-v6\\.css\\?v=core-workspace-v6-static/);\n    const workspaceLinkAt = canonicalHtml.indexOf('/app/super-core-workspace-v6.css?v=core-workspace-v6-static');\n    const firstBodyAt = canonicalHtml.indexOf('<body');\n    assert.ok(workspaceLinkAt >= 0 && (firstBodyAt < 0 || workspaceLinkAt < firstBodyAt), 'V6 debe cargarse en head antes del primer paint');\n    assert.ok(canonicalHtml.includes('background:rgba(250,252,253,.72)!important'), 'botones claros deben venir en CSS inicial del servidor');\n    assert.ok(canonicalHtml.includes('color:#17212b!important'), 'texto oscuro debe venir en CSS inicial del servidor');\n    const workspaceCssResponse = await fetch(base + '/app/super-core-workspace-v6.css');\n    const workspaceCss = await workspaceCssResponse.text();\n    assert.equal(workspaceCssResponse.status, 200);\n    assert.match(workspaceCss, /--core-v6-orange:#f97316/);\n    assert.match(workspaceCss, /body\\{background:var\\(--core-v6-bg\\)!important/);\n\n'''
t = t.replace(loop_anchor, checks + loop_anchor, 1)
shared_anchor = "    assert.ok(!sharedEntry.includes('MutationObserver'));\n"
assert shared_anchor in t
more = "    assert.ok(!sharedEntry.includes('installWorkspaceTheme'));\n    assert.ok(!sharedEntry.includes('insertAdjacentHTML'));\n    assert.ok(!sharedEntry.includes('super-core-workspace-v6-style'));\n"
t = t.replace(shared_anchor, shared_anchor + more, 1)
test.write_text(t)
