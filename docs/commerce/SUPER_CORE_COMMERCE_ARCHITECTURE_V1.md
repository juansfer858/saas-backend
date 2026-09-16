# Vantix Commerce sobre Super Core — Arquitectura V1

## Objetivo

Construir la vertical Comercio/Supermercado sin duplicar el ERP existente y sin acoplar los módulos entre sí.

El mismo Super Core debe soportar tres estrategias comerciales sin cambiar backend:

1. SAINT + Vantix en paralelo durante transición.
2. Dos shells separados: Operación y Fiscal/Contable.
3. Un único shell completo.

## Estado real del Super Core reutilizable

El Core ya contiene:

- aislamiento multitenant por `tenantId`;
- usuarios por tenant;
- RBAC con permisos por módulo/acción;
- roles por tenant;
- asignación de múltiples roles a usuario;
- overrides ALLOW/DENY por usuario;
- auditoría RBAC;
- productos con SKU y código de barras;
- movimientos de inventario y costo promedio;
- ventas/compras mediante comprobantes comerciales;
- cajas y bancos (`CajaBanco`);
- aperturas/cierres de caja con usuario, saldo inicial, esperado, final y descuadre;
- movimientos de tesorería;
- cartera CxC/CxP;
- pagos;
- contabilidad;
- conciliación bancaria;
- runtime Edge ya contemplado por el servidor.

Por lo tanto, Vantix Commerce NO debe reconstruir Ventas, Compras, Inventario, Cartera, Tesorería, Terceros ni Contabilidad.

## Huecos que Commerce debe añadir

### 1. Module Registry

Registrar módulos/capacidades disponibles por tenant y por plan.

Ejemplo:

- SALES
- PURCHASES
- INVENTORY
- TREASURY
- ACCOUNTING
- REGISTERS
- RETAIL_POS
- ONLINE_ORDERS
- DELIVERY
- FISCAL_ADAPTER
- LEGACY_BRIDGE

El shell debe construirse desde este registro y desde los permisos efectivos del usuario.

### 2. Scopes de datos

El RBAC actual responde si un usuario puede ejecutar una acción, pero Commerce necesita limitar sobre QUÉ datos puede hacerlo.

Scopes iniciales:

- `self`
- `assigned_register`
- `assigned_warehouse`
- `store`
- `tenant`

Ejemplos:

- Cajero: `VENTAS.CREAR` + `assigned_register`.
- Supervisor: permisos de caja + `store`.
- Bodeguero: inventario + `assigned_warehouse`.
- Administrador: `tenant`.

Los scopes deben validarse en backend, no sólo ocultar UI.

### 3. Caja física vs turno

`CajaBanco` será la caja física.
`AperturaCierreCaja` será la base del turno.

Debe ampliarse sólo si hacen falta datos retail adicionales, por ejemplo:

- sede;
- terminal/dispositivo;
- PIN/autorización de supervisor;
- estado operativo de la terminal;
- cierre/arqueo retail detallado.

No crear usuarios llamados “Caja 01”. Cada empleado conserva identidad propia.

### 4. Shells

Un único backend, diferentes presentaciones:

- `full`: ERP completo;
- `operation`: operación sin contabilidad/fiscal avanzada;
- `fiscal`: contabilidad, tesorería, documentos fiscales;
- `transition`: interfaz de transición tipo SAINT.

Los shells no duplican módulos ni datos.

### 5. Commerce Edge

El supermercado opera contra PostgreSQL local.

Regla:

- Edge local = maestro operativo.
- Cloud = control SaaS, respaldo, monitoreo, actualizaciones y canales externos.

Las cajas no dependen de Internet para vender.

### 6. Eventos de dominio

Evitar dependencias directas entre módulos.

Ejemplos:

- `sale.completed`
- `sale.cancelled`
- `purchase.received`
- `payment.registered`
- `shift.opened`
- `shift.closed`

Primera implementación recomendada: PostgreSQL Outbox + worker local.

Ventas no debe actualizar tablas internas de otros dominios fuera de contratos explícitos.

### 7. Fiscal Adapter

Contrato fiscal desacoplado.

Primera implementación: Cuenti.

Ventas no debe depender directamente de Cuenti.

### 8. Legacy Bridge

SAINT debe entrar mediante adaptador independiente:

`SAINT -> reader -> normalizer -> mapper -> Super Core API`

Modos:

- importación inicial;
- sincronización temporal durante transición;
- consulta histórica.

## Matriz de reutilización inicial

| Función | Estado |
| --- | --- |
| Tenant | REUTILIZAR |
| Usuarios | REUTILIZAR |
| RBAC módulo/acción | REUTILIZAR |
| Overrides por usuario | REUTILIZAR |
| Ventas | REUTILIZAR |
| Compras | REUTILIZAR |
| Productos/código de barras | REUTILIZAR |
| Inventario/kardex | REUTILIZAR |
| Cartera | REUTILIZAR |
| Tesorería/Bancos | REUTILIZAR |
| Contabilidad | REUTILIZAR |
| Conciliación bancaria | REUTILIZAR |
| Apertura/cierre de caja | REUTILIZAR/ADAPTAR |
| Module Registry | CREAR |
| Scopes | CREAR |
| Shell dinámico | ADAPTAR |
| POS retail | CREAR COMO CAPA |
| Cajas múltiples retail | ADAPTAR |
| Pedidos QR/Web/My Plaza | CREAR COMO CANAL |
| Despacho/Domicilios | CREAR/REUTILIZAR contratos existentes donde aplique |
| Fiscal Adapter/Cuenti | CREAR |
| Legacy Bridge/SAINT | CREAR |
| Cloud Sync / Backups Edge | ADAPTAR infraestructura Edge existente |

## Orden de implementación

1. Congelar contrato actual de tenant/RBAC.
2. Añadir scopes sin romper permisos existentes.
3. Añadir Module Registry.
4. Hacer el shell dinámico por módulos + permisos.
5. Validar CajaBanco/AperturaCierreCaja para retail.
6. Crear POS Comercio encima de Ventas existentes.
7. Conectar código de barras e inventario existente.
8. Crear Commerce Edge local-first.
9. Añadir sync/backups cloud.
10. Añadir Fiscal Adapter.
11. Añadir canales Web/QR/My Plaza.
12. Añadir Legacy Bridge SAINT.

## Regla de seguridad

No tocar producción ni cambiar contratos compartidos de Restaurante para implementar Comercio sin una revisión explícita de impacto.

Commerce debe nacer como una vertical nueva sobre contratos existentes y con rollback claro.
