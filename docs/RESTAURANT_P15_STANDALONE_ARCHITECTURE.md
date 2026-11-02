# VantixGC Restaurante P15 · Standalone Local Primary

## Estado

Laboratorio aislado. No mergear ni desplegar a restaurantes productivos hasta completar las pruebas de instalación, operación sin Internet, reinicio, backup y restauración en un segundo PC.

## Principio

La operación del restaurante es local y autoritativa. Internet nunca participa en una venta, pedido, impresión, cierre de caja o movimiento operativo.

```text
Tablets / Caja / KDS / Admin
            |
            | LAN
            v
Vantix Restaurant Server P15
            |
            +-- PostgreSQL local
            +-- Print service
            +-- Backup agent
            +-- Update agent
            |
            | cuando hay Internet
            v
Vantix VPS / Super Core
  backups · licencias · updates · monitoreo · recuperación
```

## Aislamiento de laboratorio

- Rama: `pilot/restaurant-standalone-p15`
- Instalación: `C:\ProgramData\VantixGC\Restaurant-P15-Lab`
- HTTP laboratorio: `8815`
- PostgreSQL laboratorio: `55435`
- Base: `vantix_restaurant_p15_lab`
- Installation ID: `HOME-PILOT-P15`
- No usar ni detener: Edge `8788`, P13 `8790/55432`, P14 `8791/55433`.
- No modificar `main` ni producción.

## Autoridad

P15 local es autoridad para Mesas, Pedidos, Cocina/Barra, Caja, pagos, impresión, Inventario operativo, Compras operativas, usuarios locales, turnos, cierres y auditoría.

El VPS es autoridad únicamente para licenciamiento, catálogo de instalaciones, versiones, distribución de actualizaciones, recepción de backups y recuperación remota.

## Servicios Windows objetivo

- `VantixGC Restaurant P15 Server`
- `VantixGC Restaurant P15 PostgreSQL`
- `VantixGC Restaurant P15 Print`
- `VantixGC Restaurant P15 Backup`

No usar Task Scheduler ni watchdogs como mecanismo principal de vida del runtime.

## Backup

El backup remoto debe incluir:

- backup base PostgreSQL;
- WAL para recuperación point-in-time;
- `pg_dump` periódico como segunda vía;
- archivos del tenant;
- configuración funcional;
- metadatos de impresoras sin depender de la IP/USB física del equipo nuevo;
- manifiesto firmado con versión, tenant, instalación, fecha y checksums.

## Recuperación

Una recuperación debe poder instalar P15 en un PC limpio, descargar un backup cifrado, restaurar PostgreSQL y archivos, pedir confirmar las conexiones físicas de impresoras y dejar el restaurante operativo sin depender de Internet después de la restauración.

## Prueba de aceptación mínima

1. Instalar en PC de laboratorio.
2. Iniciar con Internet y confirmar licencia inicial.
3. Desconectar físicamente Internet.
4. Abrir mesas, crear pedidos, trabajar KDS, entregar, cobrar e imprimir.
5. Cerrar caja.
6. Reiniciar Windows todavía sin Internet.
7. Confirmar que todo sigue operativo y los datos persisten.
8. Reconectar Internet y crear backup remoto.
9. Instalar P15 en un segundo PC limpio.
10. Restaurar desde VPS y comparar conteos y checksums.

P15 no pasa a cliente real hasta que los diez puntos sean verdes.

## Migración de restaurantes existentes

Los restaurantes actuales siguen exactamente como están hasta que P15 pase la aceptación completa.

La migración será una actualización controlada por tenant:

1. congelar escritura durante una ventana corta;
2. exportar datos del tenant productivo;
3. restaurarlos en PostgreSQL local P15;
4. comparar usuarios, productos, terceros, inventario, mesas, pedidos, ventas, compras, caja, contabilidad y auditoría;
5. probar impresión y LAN;
6. activar P15 local;
7. mantener Super Core como control plane y backup;
8. conservar rollback documentado al sistema anterior hasta cerrar la migración.

Nunca se actualizan todos los restaurantes a la vez. Primero laboratorio, luego un piloto voluntario, luego despliegue gradual.