from pathlib import Path
import re

app = Path('src/app.js')
s = app.read_text()

# Replace tenant sidebar generation with context-aware SPA/static rendering.
pattern = re.compile(r"function canonicalTenantSidebarHtml\(requestPath, options = \{\}\) \{.*?\n\}\n\nfunction replaceLegacyTenantSidebar\(html, requestPath, options = \{\}\) \{.*?\n\}\n\nfunction injectBeforeHeadEnd", re.S)
replacement = r'''function canonicalTenantSidebarHtml(requestPath, options = {}) {
  const dynamicTenant = options.dynamicTenant === true;
  const tenantName = dynamicTenant
    ? '${window.VantixGCTenantIdentity?.nameHtml?.() || ""}'
    : '';
  const tenantMeta = dynamicTenant
    ? '${window.VantixGCTenantIdentity?.metaHtml?.() || ""}'
    : '';
  return `<aside class="sidebar core-tenant-sidebar" id="sidebar" data-core-sidebar-version="${TENANT_SIDEBAR_VERSION}" data-core-visual-theme="${SUPER_CORE_VISUAL_THEME}" data-core-sidebar-stability="${SIDEBAR_STABILITY_VERSION}"><div class="brand"><div class="core-brandmark">V</div><div>VantixGC<br><small>Super Core</small></div></div><div class="core-v5-tenant" data-core-tenant-card="true"><b data-core-tenant-name="true">${tenantName}</b><span data-core-tenant-meta="true">${tenantMeta}</span></div><div class="nav-title">Principal</div>${canonicalTenantNavHtml(requestPath)}</aside>`;
}

function replaceLegacyTenantSidebar(html, requestPath) {
  const sidebarPattern = /<aside class=(['"])(?:sidebar|side)\1[^>]*>[\s\S]*?<\/aside>/g;
  return html.replace(sidebarPattern, (_match, _quote, offset) => {
    const before = html.slice(0, offset);
    const insideScript = before.lastIndexOf('<script') > before.lastIndexOf('</script>');
    return canonicalTenantSidebarHtml(requestPath, { dynamicTenant: insideScript });
  });
}

function injectBeforeHeadEnd'''
s2, count = pattern.subn(lambda _match: replacement, s, count=1)
assert count == 1, 'tenant sidebar v1 block not found exactly once'
s = s2

old_call = "    const canonicalized = replaceLegacyTenantSidebar(html, req.path, { dynamicTenant: filePath === panelHtmlPath });"
new_call = "    const canonicalized = replaceLegacyTenantSidebar(html, req.path);"
assert old_call in s, 'old contextual call not found'
s = s.replace(old_call, new_call, 1)

# Install one identity source in head before any page controller runs.
marker = '</style><script id="core-nav-access-bootstrap">'
assert marker in s, 'navigation head marker missing'
identity = '''</style><script id="core-tenant-identity-bootstrap">(()=>{const key='vantixgc_core_session_v1';const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};const textName=()=>{const s=read();return s?.tenant?.nombreEmpresa||s?.subdomain||''};const textMeta=()=>{const s=read();if(!s?.subdomain)return '';return s.subdomain+(s.tenant?.pais?' · '+s.tenant.pais:'')};const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));window.VantixGCTenantIdentity=Object.freeze({nameText:textName,metaText:textMeta,nameHtml:()=>esc(textName()),metaHtml:()=>esc(textMeta())})})();</script><script id="core-nav-access-bootstrap">'''
s = s.replace(marker, identity, 1)
app.write_text(s)

# Adapt UI smoke to the final contract.
test = Path('scripts/panel-ui-smoke.js')
t = test.read_text()
t = t.replace("    assert.ok(canonicalHtml.includes('state.session.tenant?.nombreEmpresa||state.session.subdomain'), 'SPA sidebar debe derivar tenant directamente de la sesión en cada render');\n", "    assert.ok(canonicalHtml.includes('window.VantixGCTenantIdentity?.nameHtml?.()'), 'SPA sidebar debe derivar tenant del bootstrap único en cada render');\n    assert.match(canonicalHtml, /core-tenant-identity-bootstrap/);\n")
t = t.replace("    assert.match(salesHtml, /data-core-tenant-first-paint=\\\"true\\\"/);\n", "    assert.match(salesHtml, /core-tenant-identity-bootstrap/);\n")
assert 'data-core-tenant-first-paint' not in t, 'obsolete first-paint assertion remains'
test.write_text(t)

# Update contract note.
doc = Path('SUPER_CORE_TENANT_IDENTITY_V1.md')
d = doc.read_text()
d = d.replace('En cada render debe usar la sesión actual. Las páginas completas hidratan la tarjeta en el primer parseo y conservan `panel-restaurant-entry.js` sólo como respaldo.', 'En cada render debe usar `window.VantixGCTenantIdentity`, creado en el `<head>` desde la sesión activa. Las páginas completas dejan la tarjeta vacía hasta la hidratación segura y conservan `panel-restaurant-entry.js` sólo como respaldo. Nunca se usa una identidad global como tenant sustituto.')
doc.write_text(d)
