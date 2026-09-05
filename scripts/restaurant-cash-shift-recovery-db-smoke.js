'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const identity = require('../src/modules/restaurant/restaurant-identity.service');

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: `Caja Recovery QA ${stamp}`,
      subdomain: `cash-recovery-${stamp}`,
      nicho: 'RESTAURANTE_QA',
      pais: 'CO',
      moneda: 'COP'
    }
  });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Cajero Recovery',
      email: `cashier-${stamp}@qa.local`,
      password: 'not-login',
      rol: 'CAJERO'
    }
  });
  const other = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Otro Cajero',
      email: `other-${stamp}@qa.local`,
      password: 'not-login',
      rol: 'CAJERO'
    }
  });
  const cash = await prisma.cajaBanco.create({
    data: {
      tenantId: tenant.id,
      tipo: 'CAJA',
      nombre: `Caja Recovery ${stamp}`,
      saldoActual: 0,
      activo: true
    }
  });
  const shift = await prisma.aperturaCierreCaja.create({
    data: {
      tenantId: tenant.id,
      cajaBancoId: cash.id,
      userId: owner.id,
      estado: 'ABIERTA',
      saldoInicial: 50000
    }
  });

  const ownerView = await identity.cashShiftState(tenant.id, owner.id);
  assert.equal(ownerView.ownShift?.id, shift.id);
  assert.equal(ownerView.ownShift?.ownedByCurrentUser, true);
  assert.equal(ownerView.ownShift?.cajaBanco?.id, cash.id);
  assert.equal(ownerView.ownShift?.user?.id, owner.id);

  const otherView = await identity.cashShiftState(tenant.id, other.id);
  assert.equal(otherView.ownShift, null);
  assert.equal(otherView.openShifts.length, 1);
  assert.equal(otherView.openShifts[0].id, shift.id);
  assert.equal(otherView.openShifts[0].ownedByCurrentUser, false);

  await prisma.aperturaCierreCaja.update({
    where: { id: shift.id },
    data: { estado: 'CERRADA', cerradoEn: new Date(), saldoFinal: 50000, saldoEsperado: 50000, descuadre: 0 }
  });

  const closedView = await identity.cashShiftState(tenant.id, owner.id);
  assert.equal(closedView.ownShift, null);
  assert.equal(closedView.openShifts.length, 0);

  console.log(JSON.stringify({
    ok: true,
    sameUserRecoversOpenShift: true,
    otherUserDoesNotAdoptShift: true,
    closedShiftIsNotRecovered: true
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
