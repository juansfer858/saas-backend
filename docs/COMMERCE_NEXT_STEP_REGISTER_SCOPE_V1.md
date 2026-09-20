# Commerce Next Step — Persisted Register Scope V1

## Punto actual

Ya existe el contrato puro de scopes, el resolver de caja asignada por turno abierto y un middleware aislado que combina RBAC + scope. El router HTTP de laboratorio sigue sin montarse en `src/app.js`.

## Siguiente frontera

Persistir asignaciones de alcance sin modificar el campo legado `User.rol` ni romper los roles existentes.

### Objetivo mínimo

Permitir que un usuario/rol reciba un grant como:

```text
VENTAS.VER + ASSIGNED_REGISTER
```

y que la resolución de `ASSIGNED_REGISTER` use exclusivamente cajas abiertas del mismo tenant.

### Reglas

1. `tenantId` obligatorio en toda asignación.
2. Ningún grant puede ampliar permisos: primero debe existir el permiso RBAC.
3. `NONE` niega acceso aunque exista el permiso.
4. `TENANT` es explícito; no es fallback.
5. `ASSIGNED_REGISTER` nunca acepta una caja de otro tenant.
6. La UI no decide el scope; sólo lo representa.
7. Restaurante permanece sin cambios mientras Comercio siga en laboratorio.

## Secuencia propuesta

1. Modelar persistencia de grants/scopes.
2. Añadir servicio CRUD aislado por tenant.
3. Extender `effectivePermissions` sólo mediante un servicio paralelo de autorización compuesta, sin cambiar comportamiento actual.
4. Crear fixture con Caja 01 / Caja 02 y dos cajeros.
5. Validar HTTP 200/403 contra PostgreSQL descartable.
6. Sólo después conectar una ruta real de Comercio.
