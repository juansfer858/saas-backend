# Vantix Bike sobre Super Core — Arquitectura V1

## Regla principal

Bike es un vertical independiente sobre Super Core. No puede depender de Restaurante ni de otro vertical.

## Reutiliza del Super Core

- `Tenant`, autenticación y RBAC.
- `Tercero` para cliente/propietario y proveedores.
- `Producto` + `MovimientoInventario` para repuestos, accesorios y bicicletas vendibles.
- Comercial para ventas/compras y documentos.
- Tesorería/Pagos para caja y recaudos.
- Printing/DIAN para documentos fiscales cuando aplique.
- Notifications para eventos de cliente.
- Edge para operación offline/sincronización.
- Auditoría y reporting transversales.
- Registro universal de verticales y `TenantVerticalEntitlement` para habilitar Bike por empresa.

## Pertenece exclusivamente a Bike

- Pasaporte de bicicleta (`BikeAsset`).
- Componentes instalados.
- Catálogo técnico de servicios y duración.
- Órdenes de taller.
- Diagnóstico/hallazgos.
- Evidencias de ingreso, avance, prueba y entrega.
- Agenda de taller.
- Prueba final.
- Portal del ciclista (capa posterior; consume estos contratos, no duplica datos).

## Regla de entitlement

Bike está registrado como vertical `BIKE`. Toda API `/bike` exige que el tenant tenga el entitlement Bike activo además de los permisos RBAC correspondientes. Ser `ADMIN` no sustituye el entitlement comercial del vertical.

Mientras el adaptador Edge Bike no exista y no haya sido validado, el registro declara `localFirst: false`, `edgeAdapter: null` y `edgeWorkspace: null`. Solo después de entregar y probar el runtime local se podrá cambiar ese contrato a `localFirst: true`.

## Regla de integración de inventario

`BikeWorkOrderItem.productId` referencia lógicamente el `Producto.id` canónico del Super Core. Bike no mantiene un segundo stock. Reservas/consumos deben implementarse usando contratos del módulo `inventory`.

## Regla de clientes

`BikeAsset.customerThirdPartyId` y `BikeWorkOrder.customerThirdPartyId` usan `Tercero.id` y siempre deben comprobar `tenantId`. No existe una tabla paralela de clientes Bike.

## Regla de caja/facturación

Una OT terminada genera/consume contratos comerciales y de tesorería existentes. Bike no crea una caja ni un sistema fiscal propio.

## Multiempresa

Todas las entidades Bike llevan `tenantId`. `branchId` queda como scope operacional opcional hasta consolidar el contrato común de sucursales del Super Core. Ninguna consulta Bike puede operar solo por `id` sin verificar `tenantId`.

## Offline y nube

El dominio Bike debe emitir sus mutaciones hacia la infraestructura Edge/outbox existente. Sincronización y backup siguen siendo responsabilidades de plataforma, no del módulo Bike.

## Fases

1. Foundation: schema, RBAC, entitlement, bicicletas, catálogo técnico.
2. Taller: diagnóstico → cotización → autorización → ejecución → prueba final.
3. Agenda: capacidad por técnico y reservas de cliente.
4. Inventory bridge: reserva/consumo con `inventory` canónico.
5. Commercial bridge: venta/cobro/documento usando módulos comunes.
6. Rider Portal y notificaciones.
7. Edge/PostgreSQL local + Cloud Sync + backup/restore; solo entonces `localFirst: true`.

## Invariantes

- Bike nunca importa código de `restaurant`.
- Restaurante nunca importa código de `bike`.
- Inventario, caja, terceros y plataforma son compartidos por contrato.
- Toda lectura/escritura Bike está aislada por tenant.
- Toda API Bike exige entitlement del vertical y permiso RBAC.
- Un repuesto instalado debe terminar en movimiento del inventario canónico, no en un stock Bike.
- El registro de verticales nunca anuncia capacidades Edge Bike antes de que existan y pasen CI.
