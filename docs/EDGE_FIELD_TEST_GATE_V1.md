# VantixGC Edge Offline-First V1 — Gate de prueba física

Estado actual: **NO APROBADO EN CAMPO**.

Este documento define el gate físico de impresión/Edge. Ningún CI, socket simulado, listener TCP de QA ni prueba automatizada puede marcar este gate como aprobado.

## 1. Evidencia obligatoria

La sesión debe realizarse en un computador/dispositivo físico distinto del servidor de CI, conectado a una red local real y a una impresora térmica comercial por LAN.

Debe quedar evidencia de esta secuencia:

1. Edge Agent iniciado con catálogo sincronizado.
2. Estado inicial visible: `Conectado · 0 pendiente(s)`.
3. Desconexión física de WAN/Wi-Fi/cable del dispositivo.
4. Estado visible: `Modo offline — N pendiente(s)`.
5. Venta completa en efectivo registrada localmente.
6. Ticket físico impreso correctamente por LAN/ESC-POS mientras el dispositivo sigue sin Internet.
7. Política `CASH_ONLY` bloqueando tarjeta/QR con mensaje visible al cajero.
8. Reconexión física de WAN.
9. Cola vuelve automáticamente a `0 pendiente(s)`.
10. La venta sincronizada aparece en Core central con AU, Kardex/Consumo, Tesorería/Cartera y outbox DIAN.
11. Exportación de `/api/field-evidence` de la misma sesión.

Si hay una segunda marca de impresora disponible, repetir los pasos de impresión y registrar resultado por marca.

## 2. Reporte formal de sesión

Crear un archivo `field-session.json` con este formato:

```json
{
  "sessionId": "EDGE-FIELD-YYYYMMDD-001",
  "date": "YYYY-MM-DD",
  "operator": "Nombre",
  "device": {
    "type": "PC/miniPC/tablet",
    "os": "Windows/Linux",
    "network": "WiFi/Ethernet",
    "physicalWanDisconnected": true
  },
  "printers": [
    {
      "brand": "Marca",
      "model": "Modelo",
      "transport": "LAN TCP/9100",
      "ticketPrintedOffline": true,
      "formatOk": true,
      "charactersOk": true,
      "qrOkIfApplicable": true
    }
  ],
  "cashOnlyBlockVisible": true,
  "automaticSyncAfterReconnect": true,
  "centralEffectsVerified": {
    "accountingAU": true,
    "inventoryOrConsumption": true,
    "treasuryOrReceivable": true,
    "dianOutbox": true
  },
  "fieldEvidenceFile": "field-evidence.json",
  "unexpectedFindings": [],
  "result": "PASS"
}
```

`result` solo puede ser `PASS` si todos los valores obligatorios anteriores son verdaderos y existe evidencia real de impresora física + desconexión física de WAN.

## 3. Excepción deliberada de desarrollo — Restaurante Fase 2

A partir del 20 de agosto de 2026 se autoriza iniciar Restaurante Fase 2 **en modo funcional simulado**, sin esperar disponibilidad de impresora térmica física.

Esta excepción únicamente cambia el gate de **desarrollo**. No cambia el gate de **producción real** y no marca esta prueba física como aprobada.

Estado permitido durante la excepción:

`RESTAURANTE FASE 2: FUNCIONAL — VALIDADO CON IMPRESIÓN SIMULADA (PDF/PANTALLA)`

Estado expresamente prohibido mientras el gate siga pendiente:

`RESTAURANTE: LISTO PARA PRODUCCIÓN CON CLIENTES REALES`

La simulación debe mantener la misma lógica de enrutamiento de impresión por estación; solo cambia el destino final desde ESC/POS físico hacia un registro/PDF/pantalla de comanda simulada.

## 4. Regla de destrabe para producción real

Restaurante no puede declararse listo para vender a clientes reales hasta que se cumplan simultáneamente:

- sesión física Edge = `PASS` y spooler probado con impresora térmica real;
- Meta `business_management` deje de estar pendiente en `0 de 1 llamadas de prueba necesarias` y la revisión quede resuelta;
- DIAN/PT real quede habilitado, o exista una decisión comercial explícita y documentada sobre el alcance fiscal permitido mientras continúa en simulación.

El código del vertical debe reflejar estos gates de forma visible y mantener `PRODUCCIÓN REAL BLOQUEADA` mientras alguno permanezca abierto.

## 5. Decisión sobre DIAN

Se mantiene la decisión de no bloquear desarrollo por un trámite externo. Mesas, toma de pedidos, comandas, KDS, división de cuenta, propina, caja/turno, roles y consumo de recetas pueden validarse con Documento Equivalente simulado mientras DIAN real no esté habilitada.

La aceptación fiscal real sigue siendo un gate independiente de producción.

## 6. Estado de este documento

Mientras no exista una sesión física adjunta y verificable:

`EDGE OFFLINE-FIRST V1: SOFTWARE APROBADO / CAMPO PENDIENTE`

`RESTAURANTE FASE 2: DESARROLLO FUNCIONAL SIMULADO AUTORIZADO`

`RESTAURANTE PRODUCCIÓN REAL: BLOQUEADA`

Ver también `RESTAURANT_PHASE2_SIMULATED_V1.md`.
