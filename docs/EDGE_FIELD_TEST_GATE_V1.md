# VantixGC Edge Offline-First V1 — Gate de prueba física

Estado actual: **NO APROBADO EN CAMPO**.

Este documento define el último gate antes de iniciar Restaurante Fase 2. Ningún CI, socket simulado, listener TCP de QA ni prueba automatizada puede marcar este gate como aprobado.

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

## 3. Regla de destrabe

Restaurante Fase 2 se mantiene **BLOQUEADA** hasta que:

- la sesión física termine en `PASS`;
- el JSON de `/api/field-evidence` quede guardado junto con `field-session.json`;
- Motor Consumo/Producción y Ventas permanezcan aprobados;
- el spooler haya sido probado con impresora física real.

## 4. Decisión sobre DIAN

Decisión de negocio adoptada para no bloquear desarrollo por un trámite externo:

**Restaurante Fase 2 podrá iniciar en paralelo a la habilitación DIAN únicamente después de aprobar la prueba física Edge.**

Durante ese paralelo se puede construir y validar Mesas, toma de pedidos, comandas, KDS, división de cuenta, propina, caja/turno, roles y consumo de recetas. La salida a producción con clientes reales y la aceptación fiscal final permanecen bloqueadas hasta que el Proveedor Tecnológico/DIAN confirme habilitación real del Documento Equivalente Electrónico POS.

Por tanto:

- Gate técnico para iniciar Fase 2: prueba física Edge = PASS.
- Gate comercial/fiscal para producción: DIAN/PT real = HABILITADO.

## 5. Estado de este documento

Mientras no exista una sesión física adjunta y verificable, el estado oficial es:

`EDGE OFFLINE-FIRST V1: SOFTWARE APROBADO / CAMPO PENDIENTE`

`RESTAURANTE FASE 2: BLOQUEADA`
