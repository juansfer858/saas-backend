# VantixGC Core — Restaurant Prerequisites Phase 1

## Gate original

La definición original de Fase 1 estableció que Restaurant Phase 2 no debía declararse listo para producción hasta verificar:

1. Motor genérico de Consumo/Producción.
2. Aceptación real DIAN de Documento Equivalente POS mediante el PT seleccionado.
3. Impresión física RAW/ESC-POS en impresora térmica LAN con Internet desconectado.
4. Ciclo operativo de Ventas validado de extremo a extremo.

Esa regla se conserva como referencia de cierre para producción real.

## Excepción deliberada de desarrollo — 20 de agosto de 2026

Se autoriza iniciar y validar funcionalmente Restaurante Fase 2 sin esperar el hardware de impresora térmica, usando impresión simulada PDF/pantalla. Esta excepción destraba **desarrollo y QA funcional**, pero no destraba producción real ni altera la evidencia exigida por `EDGE_FIELD_TEST_GATE_V1.md`.

Estado autorizado:

`RESTAURANTE FASE 2: FUNCIONAL — VALIDADO CON IMPRESIÓN SIMULADA (PDF/PANTALLA)`

Estado no autorizado mientras existan gates pendientes:

`RESTAURANTE: LISTO PARA PRODUCCIÓN CON CLIENTES REALES`

La regla ejecutable actual está documentada en `RESTAURANT_PHASE2_SIMULATED_V1.md`.

## 1. Consumption / Production Core V1

Generic models: `ConsumptionRecipe`, `ConsumptionRecipeItem`, `ConsumptionRun`, `ConsumptionRunItem`.

A recipe links an output product/service to N inventory ingredients. Consumption uses the same weighted-average inventory engine already used by the Core. All ingredient movements run inside one PostgreSQL transaction. Insufficient stock on any ingredient rolls back the whole run. Standalone consumption posts an AU journal DR Costo de Ventas / CR Inventario; sales integrate the recipe cost into the same sales AU so it is not double-posted.

The visible label is vertical-specific only: Restaurante can call it Receta/Escandallo; Taller can call it Orden de Trabajo/Consumo.

## 2. DIAN real adapter boundary

Provider code implemented first: `THE_FACTORY_HKA`.

The adapter is real HTTP transport for The Factory HKA Documento Equivalente REST envelope (`tokenEmpresa`, `tokenPassword`, `factura`) and parses provider/DIAN acceptance identifiers. It intentionally requires the exact `documentEquivalentSendUrl` and `facturaTemplate` validated during HKA onboarding. VantixGC does not invent a REST path or fiscal payload fields not confirmed by the PT.

The public HKA documentation identifies Documento Equivalente REST and the `EnviarRequest` method, and publishes the demo/production base hosts. Actual tenant credentials, exact integration URL, fiscal template/set and DIAN TestSetId are external onboarding inputs.

Therefore source code can prove the adapter contract and HTTP transport, but **real DIAN acceptance cannot be marked complete until the commercial/technical onboarding supplies credentials and a real set is accepted**.

Durante la Fase 2 simulada se permite asociar un Documento Equivalente explícitamente marcado como simulado. Esto no equivale a aceptación fiscal DIAN.

## 3. Local RAW/ESC-POS spooler

`edge/print-spooler` is an intentionally local edge component. The cloud SaaS must not attempt to connect directly to RFC1918 printer IPs inside a restaurant.

The agent:
- runs inside the establishment LAN;
- speaks RAW TCP (normally port 9100) and ESC/POS;
- exposes only a local HTTP API by default (`127.0.0.1:18787`);
- optionally requires `X-Vantix-Print-Token`;
- supports directed batch jobs to multiple stations;
- does not require internet to deliver a prepared local print job.

CI proves RAW TCP bytes and multi-station routing against a local mock printer. The physical-printer/no-internet acceptance criterion remains a production-site hardware test.

Durante la Fase 2 simulada, la misma lógica de enrutamiento por estación termina en un registro visible/imprimible como PDF/pantalla en vez de una impresora física. Ninguna prueba de CI puede convertir ese resultado en un `physicalPrinterFieldPass`.

## 4. Sales Operational V1

Dedicated `/app/ventas` and `/api/v1/comercial/ventas` lifecycle:

`BORRADOR -> EMITIDO -> PAGADO_PARCIAL/PAGADO_TOTAL -> ANULADO`

Emission is one database transaction:
- direct-stock Kardex and recipe ingredient consumption;
- Treasury or Cartera;
- one balanced AU containing revenue/taxes/retentions and COGS/inventory;
- commercial state transition;
- DIAN outbox creation when electronic invoicing is enabled.

Drafts have no accounting, stock, Cartera or DIAN effects. A fiscal document already accepted by the PT/DIAN cannot be silently deleted: the Core blocks ordinary cancellation and requires the appropriate electronic adjustment flow.

## Estado actual de Fase 2

**DESARROLLO FUNCIONAL SIMULADO AUTORIZADO. PRODUCCIÓN REAL BLOQUEADA.**

El desarrollo puede incluir Mesas, Salón, Menú/Recetas, Panel Mesero, QR, Comandas/KDS, cierre de mesa, división, propina, caja/turno, roles y notificaciones.

La producción real solo se destraba cuando se cumplan simultáneamente:

1. prueba física Edge/impresora térmica aprobada;
2. revisión Meta `business_management` resuelta;
3. `dianRealEnabled = true` **o** exista una decisión fiscal simulada explícita y documentada (`simulatedFiscalOperationExplicitlyAccepted = true`).

Ver `RESTAURANT_PHASE2_SIMULATED_V1.md` y `EDGE_FIELD_TEST_GATE_V1.md`.
