# Restaurante P14 · Piloto Local-First en casa

## Estado

- Rama: `pilot/restaurant-local-first-p14`
- Base inicial: `main` en `e1dca2b919d1aacef2ec9b3e592556ee0d2a26d2` (V109)
- Tenant permitido: `demo-restaurante`
- Instalación permitida: `HOME-PILOT-01`
- Canal permitido: `PILOT`
- Modo permitido: `LOCAL_FIRST`
- Producción real: sin cambios y sin activación automática

## Propósito

Validar con un solo restaurante de demostración que Centro de Control, Mesero, Producción/KDS, Caja, impresión y cierre de turno puedan operar sobre PostgreSQL local sin depender de Internet, mientras Super Core conserva licencias, respaldo, actualizaciones, QR público y consolidación.

Este piloto no crea una segunda interfaz. Debe ejecutar las superficies canónicas de Restaurante V2 sobre un runtime local single-tenant.

## Regla de seguridad

P14 permanece desactivado salvo que se cumplan simultáneamente estas cinco condiciones:

1. `RESTAURANT_LOCAL_FIRST_P14_ENABLED=true`.
2. Tenant `demo-restaurante`.
3. Instalación `HOME-PILOT-01`.
4. Canal `PILOT`.
5. Modo `LOCAL_FIRST`.

Cualquier otra combinación se rechaza. `demo-core`, tenants reales, instalaciones reales y canal `STABLE` quedan fuera del piloto.

## Arquitectura objetivo del piloto

```text
Centro de Control / Mesero / KDS / Caja
                  |
                LAN/Wi-Fi
                  |
        Runtime P14 HOME-PILOT-01
                  |
         PostgreSQL local dedicado
                  |
          Agente de sincronización
                  |
             Super Core cloud
                  ^
                  |
             QR del cliente
```

La operación interna siempre consulta y escribe localmente. La conectividad solo cambia el estado de sincronización; no cambia la base operativa durante el turno.

## Autoridad de datos

| Dominio | Autoridad durante el piloto |
| --- | --- |
| Mesas y visitas activas | Local |
| Pedidos, personas, notas y comandas | Local |
| Estados de Cocina, Barra y Postres | Local |
| Caja, pagos, recibos y cierre de turno | Local |
| Cola de impresión | Local |
| Licencia y suscripción | Super Core |
| Actualizaciones | Super Core, dirigidas únicamente a `HOME-PILOT-01` |
| QR del cliente | Entrada en Core; aceptación operativa local |
| Reportes consolidados | Core después de sincronizar eventos locales |

## Fronteras de implementación

### P14-0 · Aislamiento

- Rama nacida del `main` actual.
- Contrato fail-closed.
- Sin importar todavía el gate desde `src/app.js`, rutas o servicios productivos.
- CI dedicado que impide conectar accidentalmente P14 a producción.

### P14-1 · Runtime local de sede

- PostgreSQL local aislado.
- Runtime canónico Restaurante V2.
- Inicio automático y supervisor Windows.
- Escucha en LAN privada además de `127.0.0.1`.
- Firewall limitado a la subred privada.
- Identidad `HOME-PILOT-01`.
- Acceso desde otro computador y una tablet.

Criterio de salida: Centro de Control abre desde una tablet con la salida a Internet desconectada, conservando la red Wi-Fi local.

### P14-2 · Turno operativo completo offline

Validar sin Internet:

```text
Login
→ Abrir turno
→ Abrir mesa
→ Hacer pedido
→ Enviar a estaciones
→ Preparar y entregar
→ Pedir cuenta
→ Cobrar
→ Imprimir o no imprimir
→ Cerrar mesa
→ Cerrar turno
→ Generar informe completo
```

### P14-3 · Sincronización

- Outbox transaccional local.
- Inbox idempotente.
- Push por lotes con confirmación durable.
- Pull mediante cursor.
- Reintentos progresivos.
- Cuarentena de eventos inválidos.
- Contador visible de pendientes.
- Cero duplicados en pedidos, pagos y comandas.

### P14-4 · QR cloud

- Core recibe la solicitud.
- La solicitud queda pendiente hasta que `HOME-PILOT-01` la descargue y acepte.
- Core no muestra “en Cocina” antes de la confirmación local.
- La reconexión no duplica la solicitud.

### P14-5 · Actualización y rollback

- Release `PILOT` con `autoRollout=false`.
- Despliegue individual únicamente a `HOME-PILOT-01`.
- Respaldo previo.
- Healthcheck local.
- Rollback de binarios sin perder PostgreSQL ni outbox.

## Prohibiciones durante el piloto

- No fusionar el PR P13 completo.
- No modificar el tenant real del restaurante activo.
- No desplegar por alcance `ALL`.
- No cambiar instalaciones `STABLE`.
- No usar IndexedDB como base de Caja o pagos.
- No hacer doble escritura síncrona local/Core.
- No alternar automáticamente la autoridad de una venta entre nube y local.
- No instalar actualizaciones durante un turno abierto.
- No exponer PostgreSQL ni el runtime local directamente a Internet.

## Evidencia mínima para autorizar una sede real

1. Tres turnos completos conectados.
2. Un turno completo sin Internet.
3. Reinicio del computador sin Internet.
4. Operación simultánea desde varias superficies LAN.
5. Cierre de turno e informe exactos.
6. Reconexión con cola pendiente en cero.
7. Totales locales y Core idénticos.
8. Cero pedidos, pagos o comandas duplicados.
9. QR recibido durante desconexión y aplicado una sola vez.
10. Restauración en computador de reemplazo.
11. Actualización piloto y rollback exitosos.

## Siguiente cambio permitido

Construir P14-1 sobre esta rama sin conectar todavía el piloto a ningún tenant real: extraer del laboratorio P13 únicamente el empaquetado local verificado, actualizarlo al `main` V109 y habilitar acceso LAN privado para `demo-restaurante/HOME-PILOT-01`.
