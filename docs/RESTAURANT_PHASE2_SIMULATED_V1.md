# VantixGC Core — Restaurante Fase 2 · Modo Funcional Simulado V1

Estado oficial: **FUNCIONAL — VALIDADO CON IMPRESIÓN SIMULADA (PDF/PANTALLA)**.

Este estado autoriza construir y validar funcionalmente el vertical Restaurante sin esperar disponibilidad de una impresora térmica física. Es una excepción deliberada al gate de inicio definido en `EDGE_FIELD_TEST_GATE_V1.md`; no reemplaza ni aprueba la prueba física.

## Lo que este estado significa

Se pueden desarrollar y probar Mesas, Salón, Menú/Recetas, toma de pedidos, Autopedido QR, Comandas/KDS, cierre de mesa, división de cuenta, propina, caja/turno, roles y notificaciones. Durante esta fase, el destino final de la comanda es un registro de impresión simulada visible/imprimible desde el navegador; el enrutamiento por estación debe comportarse igual que en ESC/POS real.

Este estado **NO significa listo para producción con clientes reales**.

## Gate obligatorio para producción real

La fórmula ejecutable es:

`RESTAURANT_PRODUCTION_READY = physicalPrinterFieldPass && metaBusinessManagementReviewPass && (dianRealEnabled || simulatedFiscalOperationExplicitlyAccepted)`

Los tres bloques deben estar cerrados explícitamente:

1. `physicalPrinterFieldPass = true`: sesión física de `EDGE_FIELD_TEST_GATE_V1.md` aprobada con impresora térmica LAN real y desconexión física de Internet. La evidencia debe identificar sesión y modelo de impresora.
2. `metaBusinessManagementReviewPass = true`: revisión Meta `business_management` resuelta; no puede permanecer en `0 de 1 llamadas de prueba necesarias`. La evidencia debe identificar la revisión/resolución.
3. Gate fiscal satisfecho por una de dos vías:
   - `dianRealEnabled = true`: habilitación DIAN/PT real completada y documentada; o
   - `simulatedFiscalOperationExplicitlyAccepted = true`: existe una decisión comercial/fiscal explícita, documentada y atribuida que autoriza el alcance temporal permitido con Documento Equivalente simulado. Esta alternativa **no convierte el documento simulado en documento fiscal DIAN**.

Mientras cualquiera de los tres bloques anteriores permanezca abierto, el vertical debe mostrar `PRODUCCIÓN REAL BLOQUEADA`.

## Gobernanza de `simulatedFiscalOperationExplicitlyAccepted`

Decisión adoptada antes de fusionar Fase 2:

**El tenant NO puede activar ni revocar este flag por autoservicio.** Aunque un usuario tenga rol `ADMIN` dentro del tenant, el endpoint de Restaurante rechaza cualquier intento de cambiar `simulatedFiscalOperationExplicitlyAccepted` o su evidencia asociada.

La única superficie autorizada es el **Panel SaaS VantixGC**, autenticado con `PLATFORM_ADMIN`, mediante el control `Fiscal Restaurante` del tenant. La acción solo puede ejecutarla un `PlatformSuperAdmin` activo.

Para activar el modo se exige simultáneamente:

1. justificación en texto libre de mínimo 20 caracteres;
2. confirmación explícita de la advertencia de ausencia de validez fiscal DIAN;
3. confirmación final de la acción en la interfaz del Panel SaaS.

La revocación también exige una justificación obligatoria. No existe una revocación silenciosa.

Cada activación o revocación crea un registro en `PlatformAudit` con:

- `superAdminId`;
- `tenantId`;
- fecha automática `creadoEn`;
- acción `RESTAURANT_SIMULATED_FISCAL_ACCEPT` o `RESTAURANT_SIMULATED_FISCAL_REVOKE`;
- justificación;
- estado anterior y posterior;
- advertencia aceptada;
- cantidad de documentos simulados ya emitidos al momento de la decisión.

Además, `RestaurantConfig.simulatedFiscalDecisionEvidence` conserva una instantánea de la última decisión con super-administrador, fecha, justificación, advertencia y referencia resumida de la decisión anterior.

### Advertencia obligatoria al negocio

Antes de activar el modo, el Panel SaaS muestra de forma destacada:

> Los documentos emitidos en modo fiscal simulado NO tienen validez fiscal ante la DIAN. No deben entregarse ni presentarse como si hubieran sido validados fiscalmente por la DIAN.

Cuando el flag está activo, la interfaz del Restaurante muestra también una advertencia permanente equivalente. Por tanto, la limitación no queda escondida solo en documentación técnica.

### Inmutabilidad de documentos simulados

Cada cierre de mesa sin documento DIAN real crea un `RestaurantFiscalDocument` con `mode = SIMULATED` y `simulatedData` que identifica explícitamente `fiscalAcceptance: false` y la razón de simulación.

Ese registro representa el estado fiscal **al momento de emisión**. No existe endpoint para convertir un `RestaurantFiscalDocument` `SIMULATED` en `DIAN`, ni para revalidarlo retroactivamente. Si después se habilita DIAN real o se revoca/activa nuevamente el flag, los documentos anteriores permanecen `SIMULATED` y continúan identificables como no validados fiscalmente.

La habilitación DIAN futura aplica únicamente a documentos nuevos emitidos bajo la nueva configuración.

## Alcance funcional de Fase 2

1. Mesas y plano visual configurable con estados Libre, Ocupada, Cuenta pedida y Reservada.
2. Cada apertura de mesa crea una venta `FACTURA_VENTA` en `BORRADOR` y la mesa acumula líneas sobre ese mismo documento.
3. Menú por categorías con vínculo al producto del Core y receta del Motor de Consumo/Producción. Si un ítem vendible no tiene receta, se advierte y se bloquea su envío cuando requiere consumo por receta.
4. Pedido de mesero y Autopedido QR agregan líneas al mismo borrador y crean comandas por estación `COCINA`, `BARRA` o `POSTRES`.
5. Autopedido QR no requiere aprobación previa del mesero.
6. Cierre de mesa usa la emisión transaccional de Ventas del Core: Tesorería/Cartera, AU, Kardex/Consumo y outbox DIAN permanecen dentro de la misma transacción. El Documento Equivalente puede quedar en modo simulado si DIAN real aún no está habilitada.
7. La propina se conserva separada del total fiscal de la venta y se registra en Tesorería/Contabilidad como valor por pagar, dentro de la misma transacción de cierre.
8. Caja/turno reutiliza `AperturaCierreCaja` y Tesorería del Core; no se crea una caja paralela.
9. Roles Restaurante reutilizan RBAC del Core.
10. `ORDER_READY` reutiliza el Núcleo de Notificaciones, sujeto a activación del tenant, plantilla Meta aprobada y consentimiento transaccional.

## Criterios de aceptación del modo simulado

- AC-01: Mesa abierta + pedido con receta + comanda simulada correctamente enrutada por estación.
- AC-02: Autopedido QR entra de inmediato al documento de mesa y a la cola KDS sin aprobación del mesero.
- AC-03: Cierre con división entre dos comensales y propina genera AU balanceado, consume recetas y asocia Documento Equivalente real/simulado según estado DIAN.
- AC-04: Cierre de caja coincide con la suma de mesas cerradas del turno.
- AC-05: Mesero no accede a Configuración/Contabilidad/Reportes; Cocina/Barra solo accede a su cola.
- AC-06: Estado visible `FUNCIONAL — VALIDADO CON IMPRESIÓN SIMULADA` y `PRODUCCIÓN REAL BLOQUEADA` hasta completar los tres bloques del gate.

## Criterios adicionales de gobernanza fiscal

- GF-01: un `ADMIN` del tenant no puede activar ni revocar `simulatedFiscalOperationExplicitlyAccepted`.
- GF-02: solo `PlatformSuperAdmin` puede hacerlo desde el Panel SaaS.
- GF-03: activación y revocación exigen justificación y quedan en `PlatformAudit` con actor y fecha.
- GF-04: la activación exige aceptación explícita de la advertencia de no validez fiscal DIAN.
- GF-05: documentos emitidos con `RestaurantFiscalDocument.mode = SIMULATED` permanecen identificados así después de cambios posteriores de DIAN o del flag.

## Evidencia

La automatización de CI puede probar los criterios funcionales anteriores con PostgreSQL real de integración y simulación de comanda, además de la gobernanza del flag y la inmutabilidad del marcador `SIMULATED`. Ninguna prueba automatizada puede cambiar `physicalPrinterFieldPass` a verdadero ni sustituir la sesión de campo.
