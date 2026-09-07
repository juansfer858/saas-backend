'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const checkout = require('../src/modules/restaurant/restaurant-credit-checkout-v47.public.routes');
const customers = require('../src/modules/restaurant/restaurant-credit-customer.service');

async function main(){
  assert.equal(checkout.MARKER,'VANTIX_RESTAURANT_CREDIT_CHECKOUT_V47');
  new Function(checkout.runtime);
  assert.match(checkout.runtime,/version:'47\.0\.0'/);
  assert.match(checkout.runtime,/creditMethodSticky:true/);
  assert.match(checkout.runtime,/createCustomerInline:true/);
  assert.match(checkout.runtime,/payload\.formaPago='CREDITO'/);
  assert.match(checkout.runtime,/payload\.cajaBancoId=null/);
  assert.match(checkout.runtime,/payload\.terceroId=customerId\|\|null/);
  assert.match(checkout.runtime,/method='CREDITO'; customerId=String\(c\.value\|\|''\)/);
  assert.match(checkout.runtime,/\+ Crear cliente/);
  assert.match(checkout.runtime,/\/api\/v1\/restaurante\/clientes-credito/);
  assert.match(checkout.runtime,/Crear y seleccionar/);

  const stamp=Date.now();
  const tenant=await prisma.tenant.create({data:{nombreEmpresa:`Credit Checkout ${stamp}`,subdomain:`credit-checkout-${stamp}`,nicho:'RESTAURANTE_QA',pais:'CO',moneda:'COP'}});
  await prisma.tercero.create({data:{tenantId:tenant.id,tipo:'CLIENTE',tipoDocumento:'NIT',identificacion:'222222222222',nombre:'Consumidor final',cupoCredito:0,diasPlazo:0,activo:true}});
  const created=await customers.createCreditCustomer(tenant.id,{tipoDocumento:'CC',identificacion:`10${stamp}`,nombre:'Cliente Nuevo Crédito',telefono:'3001234567',email:null,cupoCredito:80000,diasPlazo:20});
  assert.equal(created.tipo,'CLIENTE');
  assert.equal(Number(created.cupoCredito),80000);
  assert.equal(created.diasPlazo,20);
  const rows=await customers.listCreditCustomers(tenant.id,{limit:50});
  assert.equal(rows.some((row)=>row.id===created.id),true,'cliente recién creado debe aparecer en selector');
  assert.equal(rows.some((row)=>row.identificacion==='222222222222'),false,'cliente genérico no puede aparecer para crédito');

  console.log('RESTAURANT CREDIT CHECKOUT V47 SMOKE OK');
  console.log(JSON.stringify({creditSelectionStaysAuthoritative:true,closePayloadForcedToCredit:true,inlineCustomerCreate:true,newCustomerImmediatelySelectable:true,genericCustomerExcluded:true},null,2));
}

main().catch((error)=>{console.error(error);process.exitCode=1;}).finally(async()=>prisma.$disconnect());
