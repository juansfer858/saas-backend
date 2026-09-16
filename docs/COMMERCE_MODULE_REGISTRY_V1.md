# Commerce Module Registry V1

## Objetivo

Permitir que el mismo Super Core se presente como una experiencia completa, operacional, fiscal o de transición sin clonar módulos ni reconstruir lógica.

## Regla

La visibilidad de un módulo se resuelve por cuatro filtros:

1. módulo habilitado para el tenant;
2. permiso efectivo del usuario;
3. shell solicitado;
4. dispositivo compatible.

La UI no debe decidir acceso con condicionales por rol escritos a mano.

## Shells

- `FULL`: experiencia completa del Super Core.
- `OPERATION`: ventas, compras, inventario y operación diaria.
- `FISCAL`: tesorería, cartera, contabilidad, reportes y DIAN.
- `TRANSITION`: operación orientada a transición desde SAINT; por ahora usa los mismos módulos operativos y deja preparado el contrato para el futuro Legacy Bridge.

## Dispositivos

- `DESKTOP`
- `TABLET`
- `POS`
- `MOBILE`

Un mismo módulo puede estar disponible en varios dispositivos sin duplicar backend ni permisos.

## Persistencia

`PlatformTenantModule` guarda únicamente overrides por tenant:

- `moduleCode`;
- `enabled`;
- `settings`;
- `updatedByUserId`.

Si un módulo no tiene override persistido, usa `defaultEnabled` del catálogo canónico. Esto evita romper tenants actuales cuando el registry sea integrado más adelante.

## Catálogo V1

- Dashboard
- Ventas
- Compras
- Inventario
- Terceros
- Tesorería
- Cartera
- Contabilidad
- Reportes
- DIAN
- Configuración

Cada entrada declara:

- código;
- etiqueta;
- ruta existente;
- grupo visual;
- permisos requeridos;
- shells compatibles;
- dispositivos compatibles;
- orden.

## Ejemplo

Un cajero con:

```text
DASHBOARD.VER
VENTAS.VER
INVENTARIO.VER
```

al abrir `OPERATION + POS` recibe:

```text
Dashboard
Ventas
Inventario
```

No recibe Tesorería ni Contabilidad aunque existan en el mismo Super Core.

Si el tenant deshabilita Inventario:

```text
PlatformTenantModule
INVENTARIO = false
```

el mismo usuario recibe:

```text
Dashboard
Ventas
```

sin recompilar ni copiar interfaces.

## Estado de seguridad

El servicio y router están aislados. El router todavía no se monta en `src/app.js` ni reemplaza `tenantNavigationItems` productivo.

La navegación productiva actual permanece intacta hasta que el gate del registry y la regresión de administración de accesos estén verdes.

## Siguiente frontera

Construir el `Dynamic Shell Adapter` que convierta `resolveVisibleModules()` en un contrato de menú reutilizable por Desktop, Tablet y POS, primero en laboratorio y sin sustituir el sidebar productivo.
