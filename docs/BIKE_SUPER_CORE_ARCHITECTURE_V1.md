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

1. Foundation: schema, RBAC, bicicletas, catálogo técnico.
2. Taller: diagnóstico → cotización → autorización → ejecución → prueba final.
3. Agenda: capacidad por técnico y reservas de cliente.
4. Inventory bridge: reserva/consumo con `inventory` canónico.
5. Commercial bridge: venta/cobro/documento usando módulos comunes.
6. Rider Portal y notificaciones.
7. Edge/PostgreSQL local + Cloud Sync + backup/restore.

## Invariantes

- Bike nunca importa código de `restaurant`.
- Restaurante nunca importa código de `bike`.
- Inventario, caja, terceros y plataforma son compartidos por contrato.
- Toda lectura/escritura Bike está aislada por tenant.
- Un repuesto instalado debe terminar en movimiento del inventario canónico, no en un stock Bike.
