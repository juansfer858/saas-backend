# Restaurant P15 · Standalone Lab

Este directorio contiene la línea de laboratorio para convertir VantixGC Restaurantes en un sistema local-primary con respaldo cloud.

## Contrato de aislamiento

```text
HTTP          8815
PostgreSQL    55435
Database      vantix_restaurant_p15_lab
InstallDir    C:\ProgramData\VantixGC\Restaurant-P15-Lab
Installation  HOME-PILOT-P15
```

Reservados y prohibidos para P15:

```text
8788          Edge productivo
8790 / 55432  P13
8791 / 55433  P14
```

## Reglas

- Nada de este laboratorio se despliega a producción.
- P15 no altera P13, P14 ni Edge.
- P15 no usa Task Scheduler como supervisor permanente.
- La app debe poder operar completamente sin WAN.
- El VPS no participa en transacciones operativas.
- Backup, licencias, monitoreo y actualización son funciones cloud desacopladas.
- La migración de restaurantes existentes se hará tenant por tenant y con rollback.

## Fases

- P15-0: aislamiento y contrato.
- P15-1: runtime local + PostgreSQL local como servicios.
- P15-2: módulos operativos completos por LAN.
- P15-3: impresión local.
- P15-4: backup cifrado + WAL al VPS.
- P15-5: restore en segundo PC.
- P15-6: instalador y actualización controlada para clientes existentes.
