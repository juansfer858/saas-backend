'use strict';

// Alcance canónico del cierre: operaciones del restaurante cerradas por este
// turno/cajero, más domicilios cobrados por el cajero dentro de la ventana.
// No usa la fecha de creación de la venta como sustituto del momento de cobro.
// El scope no filtra recibos anulados: V120 debe verlos y bloquearlos.
async function resolveShiftRestaurantOperations(tx, tenantId, shift) {
  const start = new Date(shift.abiertoEn);
  const end = shift?.cerradoEn ? new Date(shift.cerradoEn) : new Date();
  const window = { gte:start, lte:end };

  const [sessions, paymentRows] = await Promise.all([
    tx.restaurantTableSession.findMany({
      where:{
        tenantId,
        state:'CERRADA',
        OR:[
          { cashShiftId:shift.id },
          {
            cashShiftId:null,
            closedByUserId:shift.userId,
            closedAt:window
          }
        ]
      },
      select:{
        id:true,
        saleId:true,
        tableId:true,
        cashShiftId:true,
        closedByUserId:true,
        closedAt:true,
        splitMode:true,
        splitMetadata:true,
        paymentMethodId:true,
        paymentMethodLabel:true,
        paymentMethodKind:true,
        paymentAccountId:true,
        paymentReference:true,
        tipAmount:true,
        table:{ select:{ id:true, code:true, name:true } }
      },
      orderBy:{ closedAt:'asc' }
    }),
    tx.pago.findMany({
      where:{
        tenantId,
        userId:shift.userId,
        creadoEn:window,
        documento:{ tipo:'FACTURA_VENTA' }
      },
      select:{
        id:true,
        documentoId:true,
        comprobanteTesoreriaId:true,
        cajaBancoId:true,
        metodoPago:true,
        monto:true,
        creadoEn:true
      },
      orderBy:{ creadoEn:'asc' }
    })
  ]);

  const paymentIds = paymentRows.map((row) => row.id);
  const deliveries = paymentIds.length ? await tx.restaurantDeliveryOrder.findMany({
    where:{
      tenantId,
      treasuryPaymentId:{ in:paymentIds },
      paymentStatus:'PAGADO',
      state:{ not:'CANCELADO' }
    },
    select:{
      id:true,
      code:true,
      saleId:true,
      state:true,
      paymentStatus:true,
      paymentMethod:true,
      cajaBancoId:true,
      treasuryPaymentId:true,
      total:true,
      creadoEn:true,
      actualizadoEn:true
    },
    orderBy:{ actualizadoEn:'asc' }
  }) : [];

  const saleIds = [...new Set([
    ...sessions.map((row) => row.saleId),
    ...deliveries.map((row) => row.saleId)
  ].filter(Boolean))];

  return { start, end, window, sessions, deliveries, paymentRows, saleIds };
}

module.exports = { resolveShiftRestaurantOperations };
