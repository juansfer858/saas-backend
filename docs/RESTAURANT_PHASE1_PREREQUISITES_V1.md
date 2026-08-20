# VantixGC Core — Restaurant Prerequisites Phase 1

## Gate

Restaurant Phase 2 MUST NOT start until these four prerequisites are verified in production:

1. Generic Consumption/Production engine.
2. Real DIAN Documento Equivalente POS acceptance in habilitación through the selected authorized PT.
3. Physical RAW/ESC-POS printing to a restaurant LAN printer with internet disconnected.
4. Operational Sales lifecycle validated end-to-end.

## 1. Consumption / Production Core V1

Generic models: `ConsumptionRecipe`, `ConsumptionRecipeItem`, `ConsumptionRun`, `ConsumptionRunItem`.

A recipe links an output product/service to N inventory ingredients. Consumption uses the same weighted-average inventory engine already used by the Core. All ingredient movements run inside one PostgreSQL transaction. Insufficient stock on any ingredient rolls back the whole run. Standalone consumption posts an AU journal DR Costo de Ventas / CR Inventario; sales integrate the recipe cost into the same sales AU so it is not double-posted.

The visible label is vertical-specific only: Restaurante can call it Receta/Escandallo; Taller can call it Orden de Trabajo/Consumo.

## 2. DIAN real adapter boundary

Provider code implemented first: `THE_FACTORY_HKA`.

The adapter is real HTTP transport for The Factory HKA Documento Equivalente REST envelope (`tokenEmpresa`, `tokenPassword`, `factura`) and parses provider/DIAN acceptance identifiers. It intentionally requires the exact `documentEquivalentSendUrl` and `facturaTemplate` validated during HKA onboarding. VantixGC does not invent a REST path or fiscal payload fields not confirmed by the PT.

The public HKA documentation identifies Documento Equivalente REST and the `EnviarRequest` method, and publishes the demo/production base hosts. Actual tenant credentials, exact integration URL, fiscal template/set and DIAN TestSetId are external onboarding inputs.

Therefore source code can prove the adapter contract and HTTP transport, but **real DIAN acceptance cannot be marked complete until the commercial/technical onboarding supplies credentials and a real set is accepted**.

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

## Phase 2 status

**BLOCKED** until production verification of all four prerequisites. No Mesas, Comandas, KDS or restaurant-specific persistence is introduced by this Phase 1 branch.
