from pathlib import Path
import re

app = Path('src/app.js')
s = app.read_text()

pattern = re.compile(r"function canonicalTenantSidebarHtml\(requestPath\) \{.*?\n\}\n\nfunction replaceLegacyTenantSidebar\(html, requestPath\) \{.*?\n\}\n\nfunction injectBeforeHeadEnd", re.S)
replacement = r'''function canonicalTenantSidebarHtml(requestPath, options = {}) {
  const dynamicTenant = options.dynamicTenant === true;
  const tenantName = dynamicTenant
    ? '${esc(state.session.tenant?.nombreEmpresa||state.session.subdomain)}'
    : '';
  const tenantMeta = dynamicTenant
    ? '${esc(state.session.subdomain)}${state.session.tenant?.pais ? " · " + esc(state.session.tenant.pais) : ""}'
    : '';
  const firstPaintHydration = dynamicTenant ? '' : `<script data-core-tenant-first-paint="true">(()=>{try{const s=JSON.parse(localStorage.getItem('vantixgc_core_session_v1')||'null');if(!s?.subdomain)return;const n=document.querySelector('[data-core-tenant-name="true"]');const m=document.querySelector('[data-core-tenant-meta="true"]');if(n)n.textContent=s.tenant?.nombreEmpresa||s.subdomain;if(m)m.textContent=s.subdomain+(s.tenant?.pais?' · '+s.tenant.pais:'')}catch{}finally{document.currentScript?.remove()}})();</script>`;
  return `<aside class="sidebar core-tenant-sidebar" id="sidebar" data-core-sidebar-version="${TENANT_SIDEBAR_VERSION}" data-core-visual-theme="${SUPER_CORE_VISUAL_THEME}" data-core-sidebar-stability="${SIDEBAR_STABILITY_VERSION}"><div class="brand"><div class="core-brandmark">V</div><div>VantixGC<br><small>Super Core</small></div></div><div class="core-v5-tenant" data-core-tenant-card="true"><b data-core-tenant-name="true">${tenantName}</b><span data-core-tenant-meta="true">${tenantMeta}</span></div>${firstPaintHydration}<div class="nav-title">Principal</div>${canonicalTenantNavHtml(requestPath)}</aside>`;
}

function replaceLegacyTenantSidebar(html, requestPath, options = {}) {
  const canonical = canonicalTenantSidebarHtml(requestPath, options);
  return html.replace(/<aside class=(['"])(?:sidebar|side)\1[^>]*>[\s\S]*?<\/aside>/g, canonical);
}

function injectBeforeHeadEnd'''

s2, count = pattern.subn(replacement, s, count=1)
assert count == 1, 'canonical sidebar functions not found exactly once'
s = s2

old = "    const canonicalized = replaceLegacyTenantSidebar(html, req.path);"
new = "    const canonicalized = replaceLegacyTenantSidebar(html, req.path, { dynamicTenant: filePath === panelHtmlPath });"
assert old in s, 'sendTenantHtml canonicalization call not found'
s = s.replace(old, new, 1)
app.write_text(s)

# Strengthen UI smoke against tenant identity fallback/race.
test = Path('scripts/panel-ui-smoke.js')
t = test.read_text()
anchor = "    assert.match(canonicalHtml, /\\/app\\/super-core-workspace-v6\\.css\\?v=core-workspace-v6-static/);\n"
assert anchor in t, 'first-paint test anchor missing'
checks = "    assert.ok(canonicalHtml.includes('state.session.tenant?.nombreEmpresa||state.session.subdomain'), 'SPA sidebar debe derivar tenant directamente de la sesión en cada render');\n    assert.ok(!canonicalHtml.includes('data-core-tenant-name=\\\"true\\\">VantixGC</b><span data-core-tenant-meta=\\\"true\\\">Tenant activo'), 'SPA no puede volver al placeholder global');\n"
t = t.replace(anchor, anchor + checks, 1)

sales_anchor = "    assertCanonicalSidebar(salesHtml, '/app/ventas');\n"
assert sales_anchor in t, 'sales canonical assertion anchor missing'
sales_checks = "    assert.match(salesHtml, /data-core-tenant-first-paint=\\\"true\\\"/);\n    assert.ok(!salesHtml.includes('data-core-tenant-name=\\\"true\\\">VantixGC</b><span data-core-tenant-meta=\\\"true\\\">Tenant activo'), 'rutas completas no deben mostrar identidad global como tenant');\n"
t = t.replace(sales_anchor, sales_anchor + sales_checks, 1)
test.write_text(t)
