# VantixGC Restaurantes — Métodos de pago V1

## Regla operativa

Caja registra el método de pago exacto utilizado por el restaurante. Los métodos son configuración del nicho Restaurante y pueden activarse/desactivarse sin alterar cierres históricos.

Tipos soportados en esta fase:

- `EFECTIVO` → exige una Caja activa.
- `TRANSFERENCIA` → exige una cuenta Banco activa. Puede representar Nequi, Daviplata, Bancolombia QR, etc.
- `TARJETA` → exige una cuenta Banco activa asociada al datáfono/adquirente.
- `CREDITO` → reservado para el flujo con cliente/cartera; no se activa por defecto.

## Snapshot histórico

Cada cierre de mesa conserva en `RestaurantTableSession`:

- `paymentMethodId`
- `paymentMethodLabel`
- `paymentMethodKind`
- `paymentAccountId`
- `paymentReference`

Por tanto, renombrar o desactivar un método en el futuro no modifica el reporte de turnos ya cerrados.

## Reporte de cierre

El cierre de turno entrega:

- Ventas totales.
- Efectivo.
- Transferencias / QR.
- Tarjetas.
- Otros electrónicos heredados.
- Crédito.
- Propinas.
- Efectivo esperado.
- Efectivo contado.
- Diferencia.
- Desglose por método configurado con número de operaciones y total.

Los cobros electrónicos pertenecen al mismo turno de Caja que los procesó, pero no incrementan el efectivo físico esperado del cajón.

## Compatibilidad

Los cierres históricos anteriores que sólo contienen `BANCO` continúan visibles como `OTRO_ELECTRONICO`. Los pagos divididos ya existentes conservan su clasificación exacta `EFECTIVO / TRANSFERENCIA / TARJETA`.
