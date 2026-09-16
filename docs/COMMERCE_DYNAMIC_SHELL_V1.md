# Commerce Dynamic Shell V1

## Objetivo

Convertir el Module Registry en un contrato de navegación reutilizable por Desktop, Tablet y POS sin reemplazar todavía el sidebar productivo del Super Core.

## Entrada

El adaptador recibe:

- tenant;
- usuario autenticado;
- shell (`FULL`, `OPERATION`, `FISCAL`, `TRANSITION`);
- dispositivo (`DESKTOP`, `TABLET`, `POS`, `MOBILE`).

## Resolución

El flujo es:

```text
Tenant
  -> módulos activos
  -> permisos efectivos RBAC
  -> filtro shell
  -> filtro dispositivo
  -> perfil de scopes por permiso
  -> menú/grupos
```

El adaptador no inventa permisos ni aplica condicionales por nombre de rol. Consume los contratos existentes de RBAC, Module Registry y scopes persistentes.

## Scope snapshot

Cada módulo visible incluye `scopeProfile` con los grants efectivos de sus permisos de entrada. Esto no sustituye la autorización backend: las rutas operativas siguen obligadas a usar el middleware scoped correspondiente.

Ejemplo:

```json
{
  "code": "VENTAS",
  "scopeProfile": [
    {
      "permissionCode": "VENTAS.VER",
      "grants": [
        { "type": "ASSIGNED_REGISTER", "resourceId": null }
      ]
    }
  ]
}
```

La UI puede usar esta información para explicar al usuario su alcance, pero nunca para conceder acceso.

## Laboratorio

El gate crea cuatro perfiles en PostgreSQL descartable:

- Cajero: `OPERATION + POS` -> Dashboard, Ventas, Inventario.
- Bodega: `OPERATION + TABLET` -> Dashboard, Compras, Inventario.
- Contador: `FISCAL + DESKTOP` -> Dashboard, Tesorería, Cartera, Contabilidad, Reportes y DIAN.
- Administrador: `FULL + DESKTOP` -> catálogo completo habilitado.

También comprueba que el cajero hereda `ASSIGNED_REGISTER` en `VENTAS.VER` y que ADMIN obtiene alcance `TENANT`.

## Seguridad de despliegue

`dynamic-shell-lab.routes.js` no está montado en `src/app.js`.

No se modifica:

- `tenantNavigationItems` productivo;
- sidebar actual;
- rutas de Restaurante;
- `main`;
- runtime Edge productivo.

## Siguiente frontera

Cuando este gate esté verde, construir una vista de laboratorio de administración/navegación que consuma el contrato dinámico. Sólo después se evaluará sustituir gradualmente la navegación estática para la vertical Comercio.
