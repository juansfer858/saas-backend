# VantixGC Accounting Core V2 — Modelo de datos y reglas

Este diseño se definió antes de la implementación y conserva el núcleo existente de `CuentaPUC`, `AsientoContable`, `DetalleAsiento`, `PeriodoContable`, `Tercero`, `CajaBanco`, `MovimientoTesoreria`, `Cartera` y partida doble.

## 1. Estados financieros

### CuentaPUC
Se amplía con:
- `clasificacionESF`: Activo Corriente, Activo No Corriente, Pasivo Corriente, Pasivo No Corriente, Patrimonio, Resultado u Orden.
- `categoriaResultado`: Ingreso Operacional, Costo de Ventas, Gasto Administración, Gasto Ventas, Ingreso No Operacional, Gasto No Operacional o Impuesto de Renta.

### ConfiguracionContable
Una fila por tenant con:
- tasa de impuesto de renta parametrizable;
- cuenta de gasto de renta;
- cuenta de renta por pagar;
- cuenta de utilidad del ejercicio;
- cuenta de pérdida del ejercicio.

Los estados se calculan desde `DetalleAsiento`; no se guardan saldos derivados.

## 2. Comprobantes y consecutivos

### TipoComprobanteContable
Por tenant: código, nombre, activo, `consecutivoPorPeriodo` y bandera de sistema.

### ConsecutivoContable
Clave única `tenantId + tipoComprobanteId + año + mes`, con `ultimoNumero`.

### AsientoContable
Se amplía con `tipoComprobanteId`, `numeroConsecutivo` y `numeroComprobante`. El número se asigna dentro de la transacción al contabilizar; un borrador no consume consecutivo.

## 3. Cierre, reversión y auditoría

### PeriodoContable
Se amplía con `cerradoEn/cerradoPorId`, `reabiertoEn/reabiertoPorId` y `asientoCierreId`.

### AuditoriaContable
Registro append-only: tenant, usuario, entidad, entidadId, acción, metadata y fecha/hora.

Reglas:
- asiento contabilizado: inmutable;
- corrección: reversión + nuevo asiento;
- cierre: asiento `CIERRE` y bloqueo del periodo;
- reapertura: solo ADMIN, reversión del cierre y auditoría.

## 4. Terceros

Se reutiliza `Tercero`, se agrega tipo `OTRO` y banderas fiscales: responsable IVA, sujeto Retefuente, ReteICA y ReteIVA. Todo asiento usa `terceroId` real por línea.

## 5. IVA y retenciones

### TarifaIVA
Por tenant: código, nombre, porcentaje, categoría (gravado/exento/excluido), cuenta IVA generado, cuenta IVA descontable y estado.

### ConceptoRetencion
Por tenant: código, nombre, tipo (Retefuente/ReteICA/ReteIVA), porcentaje, base mínima, cuenta contable, naturaleza `PAGAR/COBRAR`, automático y estado.

### DetalleAsiento
Conserva `tarifaIvaId` y `conceptoRetencionId` para trazabilidad del impuesto que originó cada línea.

### Liquidación fiscal automática
No se agrega una tabla de saldos fiscales duplicados. El documento comercial conserva su valor bruto en `total`; el valor neto se materializa en Tesorería/Cartera y las retenciones quedan congeladas en las líneas del asiento (`DetalleAsiento`) con el concepto y monto contabilizado. Así, cambiar una tarifa después no reescribe documentos históricos.

Reglas:
- compra: conceptos automáticos `PAGAR` aplicables al tercero reducen Caja/Banco/CxP y acreditan la cuenta de retención;
- venta: conceptos automáticos `COBRAR` aplicables al tercero reducen Caja/Banco/CxC y debitan la cuenta de retención a favor;
- ReteIVA usa como base el IVA del documento; Retefuente/ReteICA usan el subtotal antes de IVA;
- base mínima y porcentaje siempre salen de la configuración del tenant;
- si no hay conceptos activos/automáticos, el flujo comercial anterior queda idéntico.

Para el Comprobante Manual se agrega un servicio de “asiento fiscal”: recibe operación, cuenta base, contrapartida, tercero, base, IVA y conceptos; el backend construye las líneas impositivas y solo contabiliza si el resultado queda exactamente balanceado.

## 6. Activos fijos

### ActivoFijo
Código, nombre, proveedor, valor, residual, fechas, vida útil, método línea recta, cuenta activo, depreciación acumulada, gasto y estado.

### DepreciacionActivo
Clave única por activo+año+mes; guarda valor, asiento y usuario. La depreciación genera un asiento normal y respeta periodo cerrado.

## 7. Conciliación bancaria

### ConciliacionBancaria
Tenant, cuenta tipo BANCO, fecha de corte, saldo extracto y estado.

### PartidaExtractoBancario
Fecha, descripción, referencia, valor, débito/crédito, movimiento de tesorería vinculado y estado pendiente/conciliada.

## 8. Soportes

### SoporteAsiento
Asiento, nombre, MIME, tamaño, SHA-256, contenido binario, usuario y fecha. No modifica el asiento; agrega evidencia.

## 9. Reportes y comparativos

- Balance General: a fecha de corte.
- P&G: rango de fechas y subtotales hasta Utilidad Neta.
- Balance de Prueba y Mayor: desde movimientos reales.
- Periodo abierto: utilidad neta se presenta sintéticamente dentro de Patrimonio.
- Periodo cerrado: utilidad ya trasladada por asiento de cierre y no se duplica.
- Comparativos: periodo anterior equivalente, con variación absoluta y porcentual.

## 10. Exportación

La misma fuente de datos de cada reporte genera Excel-compatible `.xls` y PDF, evitando cálculos paralelos.

## 11. Integridad transversal

- Toda consulta conserva `tenantId`.
- Todo asiento contabilizado es inmutable.
- Toda corrección usa reversión.
- Partida doble se valida antes de persistir cualquier asiento, incluidos cierre, depreciación e impuestos.
- Consecutivos se asignan dentro de transacción.
- Periodo cerrado bloquea contabilización.
- Tarifas fiscales son configurables; las plantillas de retención se crean inactivas y a 0%, nunca como supuesta tarifa legal vigente.
- Toda acción sensible deja auditoría.
