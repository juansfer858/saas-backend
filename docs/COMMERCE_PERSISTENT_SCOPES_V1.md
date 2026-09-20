# Commerce Persistent Scopes V1

## Objetivo

Persistir el alcance de datos de un permiso sin alterar el RBAC general ni el runtime productivo de Restaurante.

El RBAC actual responde **qué puede hacer** un usuario, por ejemplo `VENTAS.VER`.
Los scopes responden **sobre qué datos puede hacerlo**.

Ejemplo:

```text
VENTAS.VER + ASSIGNED_REGISTER
```

permite consultar ventas únicamente de la caja actualmente asignada al usuario.

## Persistencia

Se agrega `RbacScopeGrant` como tabla independiente del RBAC existente.

Campos principales:

- `tenantId`
- `subjectType`: `ROLE` o `USER`
- `subjectId`
- `permissionCode`
- `scopeType`
- `resourceId` opcional
- `resourceKey` estable para unicidad
- `grantedByUserId`
- `reason`
- `active`

No se agregan relaciones Prisma polimórficas a `User`/`RbacRole`; la validación de pertenencia al tenant se hace en el servicio antes de persistir.

## Precedencia

1. `ADMIN` y `SUPER_ADMIN` obtienen `TENANT`.
2. Si existen scopes activos específicos para el usuario y permiso, reemplazan los scopes heredados por rol.
3. Si no existen scopes de usuario, se heredan scopes de todos sus roles activos.
4. Sin scope efectivo, el middleware scoped falla cerrado.

Esto permite estrechar un rol compartido sin modificarlo.

Ejemplo:

```text
Rol Supervisor:
  VENTAS.VER -> TENANT

Usuario temporal:
  VENTAS.VER -> ASSIGNED_REGISTER
```

El usuario ve sólo su caja aunque su rol sea más amplio.

Para negar completamente un permiso sigue existiendo el override RBAC `DENY`. También puede usarse `NONE` como scope explícito para una frontera scoped.

## Caja física

`ASSIGNED_REGISTER` no confía en un ID enviado por el navegador.

La asignación real se resuelve desde:

```text
AperturaCierreCaja
  tenantId
  userId
  estado = ABIERTA
  cajaBanco.tipo = CAJA
  cajaBanco.activo = true
```

Por tanto:

```text
Cajero A -> turno abierto Caja 01
Cajero B -> turno abierto Caja 02
```

produce:

```text
A -> Caja 01 = permitido
A -> Caja 02 = denegado
B -> Caja 02 = permitido
B -> Caja 01 = denegado
```

Un recurso de otro tenant siempre se deniega.

## Auditoría

Crear, reactivar o desactivar scopes genera eventos en `RbacAudit`:

- `SCOPE_GRANT_SET`
- `SCOPE_GRANT_DISABLE`

## Compatibilidad

Este bloque no modifica `require-permission.js`, no monta nuevas rutas en `src/app.js` y no altera permisos de Restaurante.

Sólo las rutas que adopten explícitamente `requireScopedPermission` utilizarán esta capa.

## Gate PostgreSQL

`Commerce Persistent Scope V1 CI` levanta PostgreSQL descartable, ejecuta `prisma db push` y valida:

1. dos tenants;
2. dos cajeros del mismo tenant;
3. dos cajas distintas;
4. un turno abierto diferente para cada cajero;
5. scope de rol `ASSIGNED_REGISTER` persistido;
6. aislamiento Caja 01/Caja 02;
7. aislamiento cross-tenant;
8. scope específico de usuario con precedencia;
9. desactivación del override y restauración de herencia;
10. auditoría de cambios.

## Próxima frontera

Cuando este gate quede verde, la siguiente pieza es exponer administración de scopes detrás de rutas administrativas aisladas y luego conectar una única ruta real de laboratorio Commerce antes de tocar POS o módulos productivos.
