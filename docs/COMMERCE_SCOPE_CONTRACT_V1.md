# Commerce Scope Contract V1

## Objetivo

Extender el RBAC existente del Super Core con alcance de datos (scope) sin cambiar la semántica actual de permisos ni romper Restaurante.

RBAC responde **qué puede hacer** un usuario. Scope responde **sobre qué datos puede hacerlo**.

La autorización final será:

`tenant válido + permiso válido + scope válido + recurso perteneciente al tenant`.

## Principios

1. `tenantId` sigue siendo la frontera primaria y nunca se relaja.
2. Los scopes no reemplazan permisos; se evalúan después del permiso.
3. Un módulo sin scope activado conserva su comportamiento actual durante la migración.
4. El rollout será opt-in por módulo/vertical para evitar regresiones en Restaurante.
5. Los datos de contexto del recurso deben resolverse en servidor; no se confía en `registerId`, `warehouseId`, `ownerUserId`, etc. enviados libremente por el cliente.
6. Si un módulo activa scope y no se puede resolver un grant válido, la decisión es `DENY`.

## Tipos de scope V1

- `TENANT`: todos los recursos del tenant activo.
- `STORE`: una sede/establecimiento concreto.
- `ASSIGNED_REGISTER`: sólo caja(s) asignada(s) al usuario/turno.
- `ASSIGNED_WAREHOUSE`: sólo bodega(s)/depósito(s) asignada(s).
- `SELF`: recursos propios del usuario, por ejemplo su turno.
- `ASSIGNED`: recursos explícitamente asignados al usuario, útil para pedidos/domicilios.
- `NONE`: sin acceso al recurso aunque exista permiso de módulo.

## Ejemplos

### Cajero

- `VENTAS.CREAR` + `ASSIGNED_REGISTER`
- `VENTAS.VER` + `ASSIGNED_REGISTER`
- `TESORERIA.VER` + `SELF` o sin acceso general
- `INVENTARIO.VER` + `STORE`

Resultado: Caja 01 no puede leer ni operar Caja 02.

### Supervisor

- `VENTAS.*` + `STORE`
- `TESORERIA.VER` + `STORE`
- autorización de anulaciones/descuentos dentro de la sede.

### Bodeguero

- `INVENTARIO.VER/AJUSTAR` + `ASSIGNED_WAREHOUSE`
- `COMPRAS.VER` + `STORE`

### Administrador

- permisos administrativos + `TENANT`.

## Contexto mínimo para evaluación

El evaluador recibe un contexto ya hidratado por backend:

```js
{
  actorTenantId,
  resourceTenantId,
  actorUserId,
  resourceOwnerUserId,
  storeId,
  registerId,
  warehouseId,
  assigneeUserId,
  assignedStoreIds,
  assignedRegisterIds,
  assignedWarehouseIds,
  assignedResourceIds
}
```

No todos los campos son obligatorios; cada tipo de scope usa sólo los que necesita.

## Rollout sin romper producción

### P0 — contrato puro

Crear un evaluador de scopes puro, sin acceso a DB ni middleware. Debe ser testeable y fail-closed.

### P1 — resolución de Caja

Primera integración real: `ASSIGNED_REGISTER` usando `AperturaCierreCaja` ABIERTA del usuario y `CajaBanco` tipo CAJA.

Esto prueba el modelo con una necesidad real de Comercio y sin tocar los módulos de Restaurante.

### P2 — middleware opt-in

Agregar un middleware explícito, por ejemplo:

```js
requireScopedPermission('VENTAS.VER', {
  scope: 'ASSIGNED_REGISTER',
  resourceResolver
})
```

No modificar `enforceTenantPermissions` global hasta que existan pruebas de regresión.

### P3 — persistencia general

Definir grants de scope para rol/usuario cuando Caja V1 esté estable. Propuesta conceptual:

- scope default por rol;
- override por usuario;
- `resourceId` opcional para bindings explícitos;
- auditoría de cambios.

## Invariantes de seguridad

- Nunca autorizar recurso de otro tenant aunque el scope coincida.
- `NONE` siempre niega.
- scope desconocido siempre niega.
- `ASSIGNED_REGISTER` no acepta un `registerId` arbitrario del navegador: debe verificarse contra asignación/turno real.
- `SELF` compara contra el usuario autenticado, no contra un userId enviado por el cliente.
- ADMIN/SUPER_ADMIN conserva compatibilidad V1, pero al activar Commerce se recomienda resolverlo como `TENANT` explícito en vez de depender de bypass implícito.

## Relación con shells y módulos

Los shells (`full`, `operation`, `fiscal`, `transition`) sólo controlan presentación/navegación. La API siempre aplica permisos + scope. Ocultar un módulo en UI no es una medida de seguridad.

## Siguiente paso

Implementar `scope-policy.service.js` como contrato puro y un smoke ejecutable. Después, integrar exclusivamente `ASSIGNED_REGISTER` sobre una ruta Commerce de laboratorio antes de ampliar a bodega/sede/pedidos.
