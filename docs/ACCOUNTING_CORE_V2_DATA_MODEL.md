# VantixGC Accounting Core V2 — Modelo de datos propuesto

Este documento precede la implementación y conserva el núcleo existente de `CuentaPUC`, `AsientoContable`, `DetalleAsiento`, `PeriodoContable`, `Tercero`, `CajaBanco`, `MovimientoTesoreria` y partida doble.

## 1. Estados financieros y clasificación contable

### CuentaPUC (extensión)
- `clasificacionESF`: `ACTIVO_CORRIENTE | ACTIVO_NO_CORRIENTE | PASIVO_CORRIENTE | PASIVO_NO_CORRIENTE | PATRIMONIO | RESULTADO | ORDEN | null`.
- `categoriaResultado`: `INGRESO_OPERACIONAL | COSTO_VENTAS | GASTO_ADMINISTRACION | GASTO_VENTAS | INGRESO_NO_OPERACIONAL | GASTO_NO_OPERACIONAL | IMPUESTO_RENTA | null`.

Estas dos clasificaciones permiten generar Balance General y P&G sin hardcodear la presentación por nombre de cuenta. Para cuentas estándar se inicializan desde el catálogo colombiano; las cuentas personalizadas pueden configurarlas.

### ConfiguracionContable
Una fila por tenant:
- tasa de impuesto de renta parametrizable.
- cuenta de impuesto de renta.
- cuenta de utilidad del ejercicio.
- cuenta de pérdida del ejercicio.

Relación: `Tenant 1—1 ConfiguracionContable` y referencias opcionales a `CuentaPUC`.

## 2. Tipos de comprobante y consecutivos

### TipoComprobanteContable
Por tenant:
- código (`CI`, `CE`, `CA`, `ND`, `NC`, `NM`, etc.).
- nombre.
- activo.
- `consecutivoPorPeriodo` (mensual por defecto).
- flag de sistema para proteger tipos base.

### ConsecutivoContable
Clave única: `tenantId + tipoComprobanteId + anio + mes`.
- `ultimoNumero`.

El número se asigna dentro de la misma transacción que contabiliza el asiento. Nunca se recibe como dato editable del cliente.

### AsientoContable (extensión)
- `tipoComprobanteId`.
- `numeroConsecutivo`.
- `numeroComprobante` (ej. `CA-202608-000001`).
- mantiene `reversoDeId` existente para reversión.
- origen adicional `CIERRE`.

## 3. Cierre y auditoría

### PeriodoContable (extensión)
- `cerradoEn`, `cerradoPorId`.
- `reabiertoEn`, `reabiertoPorId`.
- `asientoCierreId`.

### AuditoriaContable
Registro append-only:
- tenant, usuario, entidad (`ASIENTO`, `PERIODO`, `CUENTA`, `IMPUESTO`, `ACTIVO`, `CONCILIACION`).
- entidadId.
- acción (`CREAR`, `CONTABILIZAR`, `ANULAR`, `CERRAR`, `REABRIR`, etc.).
- metadatos JSON.
- fecha/hora.

La reapertura exige `ADMIN` y genera auditoría. El cierre genera un asiento `CIERRE`; la reapertura genera su reversión y vuelve a abrir el periodo.

## 4. Terceros

Se reutiliza `Tercero`, ampliando el enum con `OTRO` y campos de contacto ya existentes. El Comprobante Manual usa `terceroId` real por línea; no se persiste texto libre como sustituto del tercero.

## 5. IVA y retenciones

### TarifaIVA
Por tenant:
- nombre, porcentaje, categoría (`GRAVADO`, `EXENTO`, `EXCLUIDO`).
- cuenta de IVA generado.
- cuenta de IVA descontable.
- activa.

### ConceptoRetencion
Por tenant:
- tipo (`RETEFUENTE`, `RETEICA`, `RETEIVA`).
- código/nombre.
- porcentaje y base mínima.
- cuenta contable de retención.
- naturaleza de aplicación (`PAGAR`/`COBRAR`).
- activa.

### DetalleAsiento (extensión)
- `tarifaIvaId` opcional.
- `conceptoRetencionId` opcional.

Los impuestos son configurables; el motor puede calcular líneas automáticas en comprobantes manuales a partir de base + tarifa/concepto.

## 6. Activos fijos y depreciación

### ActivoFijo
- identificación, nombre, tercero/proveedor opcional.
- valor de adquisición, valor residual, fecha de compra, fecha de inicio de depreciación.
- vida útil en meses.
- método (`LINEA_RECTA`).
- cuenta del activo, depreciación acumulada y gasto de depreciación.
- estado.

### DepreciacionActivo
Clave única `activoFijoId + anio + mes`.
- valor depreciado.
- `asientoId` generado.
- fecha de generación.

## 7. Conciliación bancaria

### ConciliacionBancaria
- tenant, cajaBanco tipo BANCO, periodo/corte, saldo extracto, estado.

### PartidaExtractoBancario
- conciliación, fecha, descripción, referencia, valor, tipo débito/crédito.
- `movimientoTesoreriaId` opcional.
- estado `PENDIENTE | CONCILIADA`.

Esto conserva el movimiento contable/tesorería como fuente de verdad y el extracto como evidencia externa.

## 8. Soportes documentales

### SoporteAsiento
- asiento, nombre, MIME, tamaño, hash.
- contenido binario (`Bytes`) para la primera versión, limitado por API.
- usuario y fecha.

No modifica el asiento; agrega evidencia enlazada.

## 9. Reportes y comparativos

No se crean tablas de saldos derivados. Balance de Prueba, P&G, Balance General, Libro Mayor y comparativos se calculan desde `DetalleAsiento` de asientos contabilizados/reversiones, excluyendo asientos de cierre cuando el reporte necesita mostrar la operación del periodo.

Reglas:
- Balance General a fecha de corte.
- P&G por rango con subtotales hasta Utilidad Neta.
- En periodo abierto, la utilidad neta se presenta de forma sintética dentro de Patrimonio.
- En periodo cerrado, la utilidad ya está trasladada a la cuenta de resultado del ejercicio y no se duplica.
- Comparativo: mismo reporte contra periodo anterior equivalente, con variación absoluta y porcentual.

## 10. Exportación

Se implementa una capa de exportación sin alterar los cálculos:
- Excel compatible: descarga `.xls` tabular generada desde el dataset del reporte.
- PDF: versión HTML imprimible desde el mismo dataset, consumida por el navegador para Guardar como PDF.

## 11. Integridad

- Todo acceso conserva `tenantId` obligatorio.
- Todo asiento contabilizado es inmutable.
- Corrección: reversión + nuevo asiento.
- Partida doble validada antes de persistir un asiento contabilizado, incluidos impuestos, cierre y depreciación.
- Numeración asignada dentro de transacción.
- Periodo cerrado bloquea nuevos asientos.
- Toda acción sensible deja `AuditoriaContable`.
