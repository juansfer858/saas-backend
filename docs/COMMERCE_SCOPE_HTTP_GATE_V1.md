# Commerce Scope HTTP Gate V1

## Objetivo

Validar el primer límite de datos de Comercio sin montar rutas nuevas en `src/app.js` y sin afectar Restaurante, Edge productivo ni `main`.

## Frontera validada

Permiso: `VENTAS.VER`

Scope: `ASSIGNED_REGISTER`

Casos del laboratorio HTTP:

1. Cajero asignado a Caja 01 consulta Caja 01 -> `200`.
2. Cajero asignado a Caja 01 consulta Caja 02 -> `403 AUTH_SCOPE_FORBIDDEN`.
3. Actor de Tenant A intenta consultar un recurso de Tenant B -> `403 AUTH_SCOPE_FORBIDDEN`.
4. Cajero asignado a Caja 02 consulta Caja 02 -> `200`.
5. Petición sin actor autenticado -> `401 AUTH_REQUIRED`.

## Implementación

- `scope-policy.service.js`: evaluación pura de scope.
- `commerce-scope-resolver.service.js`: resuelve cajas abiertas realmente asignadas al usuario.
- `require-scoped-permission.middleware.js`: combina permiso RBAC + scope.
- `commerce-scope-lab.routes.js`: router de laboratorio NO montado en el runtime.
- `check-commerce-scoped-permission-http.js`: smoke HTTP aislado con dependencias inyectadas.

## Regla de seguridad

La UI nunca constituye la barrera de seguridad. Aunque un usuario manipule URL, parámetros o requests manualmente, el backend debe comprobar permiso y alcance sobre el recurso solicitado.

## Regla de aislamiento

El middleware general de producción no se modifica en esta frontera. El router de laboratorio no se monta en `src/app.js`. La integración con rutas reales sólo podrá ocurrir después de que este gate quede verde y se haya definido persistencia de grants/scopes por usuario o rol.
