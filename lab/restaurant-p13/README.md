# P13 · VantixGC Restaurante Local Runtime

Laboratorio aislado para ejecutar la operación diaria del restaurante desde el PC local sin depender de Internet.

## Arquitectura aprobada

La superficie visible local es **únicamente Restaurante / Centro de Control**.

```text
PC / tablets / KDS
       |
       v
VantixGC Restaurante Local
       |
       +-- Centro de Control
       +-- Mesas
       +-- Mesero / Pedidos
       +-- Producción / KDS
       +-- Caja
       +-- Domicilios
       +-- Impresión
       |
       v
PostgreSQL local
       |
       +------ sync ------> Core nube
```

El **Super Core completo permanece en Internet**. El runtime local puede reutilizar internamente contratos y servicios canónicos necesarios para que Restaurante funcione sin Internet, pero no expone la interfaz administrativa completa del Super Core.

Core conserva las funciones de control central: licencias, backups, sincronización, actualizaciones, QR público, acceso remoto, administración y reportes globales.

## Aislamiento del laboratorio

- Runtime P13: `127.0.0.1:8790`.
- PostgreSQL P13: `127.0.0.1:55432/vantix_p13_lab`.
- Entrada visible local: `/app/centro-de-control-v2`.
- Edge productivo actual: `8788`, intacto.
- `main` no se modifica desde este laboratorio.
- El PR permanece `DRAFT / NO MERGE` hasta pruebas físicas.

## Fronteras validadas

- E1: usuarios, roles y permisos locales.
- E2: mesas y visitas locales.
- E3: pedidos, personas, notas y comandas.
- E4: Producción/KDS y cola local durable de impresión.
- E5: Caja mínima local: liquidación canónica, últimos cobros, documento liquidado en solo lectura y reimpresión como COPIA sin volver a afectar las tablas canónicas del negocio.

## Caja mínima

Caja no replica reportes del Super Core. Mantiene sólo lo necesario para operar:

1. Cobrar.
2. Ver `Últimos cobros`.
3. Abrir una venta liquidada y ver productos, cantidades, precios y totales.
4. Reimprimir una `COPIA` del documento.

La reimpresión escribe únicamente en la cola local de impresión. La prueba E5 compara un digest de todas las tablas canónicas del tenant antes y después de reimprimir y exige que no cambie ninguna.

## QR público

El QR del cliente es `CORE_CLOUD_ONLY`. No se publica el runtime local a Internet.

## Siguiente gate

Construir paquete Windows P13 independiente, instalarlo en paralelo al Edge actual y hacer prueba física:

`Internet ON -> OFF -> reinicio OFF -> pedido -> KDS -> Caja -> documento liquidado -> reimpresión -> Internet ON -> sync sin duplicados`.
