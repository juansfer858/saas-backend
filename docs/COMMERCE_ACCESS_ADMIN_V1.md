# Commerce Access Admin V1

## Objetivo

Dar a la vertical Comercio/Supermercado una administración reusable de usuarios, roles, permisos y scopes sobre el RBAC existente del Super Core, sin modificar las rutas productivas ni el runtime de Restaurante.

## Reglas

- Un módulo no se clona para otro usuario o dispositivo.
- El acceso se compone de `permiso + scope`.
- El tenant sigue siendo la frontera máxima de datos.
- Un scope directo de usuario reemplaza los scopes heredados de roles para el mismo permiso.
- `NONE` permite bloquear temporalmente un permiso a nivel de alcance sin modificar el rol compartido.
- Los administradores `ADMIN` / `SUPER_ADMIN` conservan alcance `TENANT` efectivo.

## Contrato administrativo aislado

Router: `commerce-access-admin.routes.js`

Este router **no se monta todavía en `src/app.js`**. Primero debe superar CI y revisión de aislamiento.

Endpoints del contrato:

- `GET /overview`
  - usuarios activos;
  - roles activos;
  - permisos de módulos de Comercio;
  - scopes persistentes;
  - cajas físicas activas;
  - tipos de scope disponibles.

- `GET /usuarios/:userId`
  - roles del usuario;
  - permisos efectivos;
  - overrides ALLOW/DENY;
  - scopes directos;
  - scopes heredados;
  - scopes efectivos por permiso.

- `POST /scopes`
  - asigna o reactiva un scope a un `ROLE` o `USER`.

- `PATCH /scopes/:grantId/disable`
  - desactiva un scope sin borrar su trazabilidad.

Todos los endpoints requieren conceptualmente `CONFIGURACION.ADMINISTRAR` cuando el router sea montado.

## Caso de supermercado

```text
Laura
  Rol: CAJERO_COMERCIO
  Permiso: VENTAS.VER
  Scope: ASSIGNED_REGISTER
  Turno abierto: Caja 01

Resultado:
  Caja 01 -> permitido
  Caja 02 -> denegado
```

```text
Supervisor
  Permiso: VENTAS.VER
  Scope futuro: STORE

Resultado:
  todas las cajas de la sede -> permitido
  otra sede -> denegado
```

## Estado V1

Incluye backend administrativo y prueba contra PostgreSQL descartable. No incluye todavía:

- montaje productivo del router;
- pantalla visual de Administración Comercio;
- Module Registry;
- shell dinámico por usuario;
- scopes STORE/WAREHOUSE conectados a entidades físicas que aún no existen como dominio Comercio.

## Gate

Workflow: `Commerce Access Admin V1 CI`

Valida:

1. Prisma generado;
2. esquema en PostgreSQL descartable;
3. sintaxis del servicio/router;
4. rol `CAJERO_COMERCIO`;
5. permiso `VENTAS.VER`;
6. scope heredado `ASSIGNED_REGISTER`;
7. override de usuario `NONE`;
8. restauración de la herencia al desactivar el override;
9. dos cajas físicas activas;
10. regresión del gate de scopes persistentes.

## Siguiente frontera

Construir `Module Registry + Shell Contract`, todavía aislado de producción, para que el menú visible sea derivado de módulos activos + permisos efectivos, y no de condicionales escritos por pantalla.
