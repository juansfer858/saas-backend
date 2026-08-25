# Super Core Tenant Identity V1

## Regla

La identidad visible del tenant y el aislamiento de datos tienen fuentes distintas pero coherentes:

- UI: la tarjeta del sidebar deriva `nombreEmpresa`, `subdomain` y `pais` de la sesión activa validada.
- API: `extractTenantBySubdomain` resuelve el tenant por host/header y fija `req.tenantId`.
- Autorización: `verifyTenant` exige que `payload.tenantId === req.tenantId` y vuelve a buscar al usuario por `id + tenantId`.

## Sidebar

El shell SPA no puede usar `VantixGC / Tenant activo` como identidad sustituta. En cada render debe usar la sesión actual. Las páginas completas hidratan la tarjeta en el primer parseo y conservan `panel-restaurant-entry.js` sólo como respaldo.

## Objetivo

Evitar carreras visuales, cambios de nombre entre módulos y cualquier impresión de que una empresa puede heredar la identidad visual de otra. El placeholder global no representa un tenant.
