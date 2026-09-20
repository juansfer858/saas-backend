'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {prisma}=require('../src/config/prisma');
const {ensureRestaurantDemoTenant}=require('./ensure-restaurant-demo-tenant');
const recipes=require('../src/modules/restaurant/restaurant-recipes-costs-v1.service');
const inventory=require('../src/modules/restaurant/restaurant-inventory-bar-v1.service');
const management=require('../src/modules/restaurant/restaurant-management-v1.service');
const demoBar=require('../src/modules/restaurant/restaurant-demo-bar-accounts-v1.service');
const identity=require('../src/modules/restaurant/restaurant-identity.service');
const {V2_OPTIONS}=require('../src/modules/restaurant/restaurant-v2-orders.routes');

async function main(){
 const demo=await ensureRestaurantDemoTenant();
 const admin=await prisma.user.findUnique({where:{id:demo.users.ADMIN}});
 assert.ok(admin);
 const suffix=crypto.randomBytes(4).toString('hex');
 const ids={};
 try{
  const product=await prisma.producto.create({data:{tenantId:demo.tenantId,sku:'REC-'+suffix,nombre:'Plato receta '+suffix,unidadMedida:'UND',controlaInventario:false,stockActual:0,costoPromedio:0,precio1:25000,activo:true}});
  ids.productId=product.id;
  const menu=await prisma.restaurantMenuItem.create({data:{tenantId:demo.tenantId,productId:product.id,category:'FUERTES',station:'COCINA',requiresRecipe:false,active:true,sortOrder:9998}});
  ids.menuItemId=menu.id;

  const ingA=await recipes.saveIngredient(demo.tenantId,admin.id,{code:'CARNE-'+suffix,name:'Carne '+suffix,unit:'g',unitCost:30,active:true});
  const ingB=await recipes.saveIngredient(demo.tenantId,admin.id,{code:'PAN-'+suffix,name:'Pan '+suffix,unit:'unidad',unitCost:1200,active:true});
  ids.ingredients=[ingA.ingredient.id,ingB.ingredient.id];

  let center=await recipes.center(demo.tenantId);
  for(const id of ids.ingredients){
    const row=center.ingredients.find(x=>x.id===id);
    await recipes.ingredientMove(demo.tenantId,admin.id,{id,version:row.stockVersion,kind:'initial',quantity:id===ingA.ingredient.id?1000:20,reason:'Saldo inicial CI'});
  }
  await recipes.saveRecipe(demo.tenantId,admin.id,product.id,[{ingredientId:ingA.ingredient.id,quantity:180},{ingredientId:ingB.ingredient.id,quantity:1}]);
  center=await recipes.center(demo.tenantId);
  const rp=center.products.find(x=>x.id===product.id);
  assert.equal(rp.hasRecipe,true);
  assert.equal(rp.recipeCost,6600);
  assert.equal(rp.margin,18400);

  const zone=await prisma.restaurantZone.create({data:{tenantId:demo.tenantId,name:'REC '+suffix,sortOrder:9998}});ids.zoneId=zone.id;
  const table=await prisma.restaurantTable.create({data:{tenantId:demo.tenantId,zoneId:zone.id,code:'R-'+suffix,name:'Mesa Rec '+suffix,seats:2}});ids.tableId=table.id;
  const account=await demoBar.createAccount(demo.tenantId,admin,table.id,{name:'Cuenta receta'});ids.sessionId=account.account.id;
  const session=await prisma.restaurantTableSession.findUnique({where:{id:ids.sessionId}});ids.saleId=session.saleId;
  await identity.setWaiterDraftItem(demo.tenantId,admin,ids.sessionId,menu.id,2,null,V2_OPTIONS);
  await identity.sendWaiterDraft(demo.tenantId,admin,ids.sessionId,V2_OPTIONS);

  center=await recipes.center(demo.tenantId);
  assert.equal(center.ingredients.find(x=>x.id===ingA.ingredient.id).reserved,360);
  assert.equal(center.ingredients.find(x=>x.id===ingB.ingredient.id).reserved,2);

  await prisma.$transaction(async tx=>{
    const result=await recipes.consumeSaleInTx(tx,demo.tenantId,admin.id,ids.sessionId,ids.saleId);
    assert.equal(result.totalCost,13200);
    await tx.restaurantTableSession.update({where:{id:ids.sessionId},data:{state:'CERRADA',closedAt:new Date(),closedByUserId:admin.id}});
  });
  center=await recipes.center(demo.tenantId);
  assert.equal(center.ingredients.find(x=>x.id===ingA.ingredient.id).onHand,640);
  assert.equal(center.ingredients.find(x=>x.id===ingB.ingredient.id).onHand,18);
  assert.equal(center.ingredients.find(x=>x.id===ingA.ingredient.id).reserved,0);

  const customer=await management.customerSave(demo.tenantId,admin.id,{name:'Cliente '+suffix,documentType:'CC',document:'DOC-'+suffix,phone:'3001234567',email:'cliente'+suffix+'@example.com',address:'Calle 1'});
  assert.ok(customer.id);
  const customers=await management.customerList(demo.tenantId,suffix);
  assert.ok(customers.some(x=>x.id===customer.id));

  const supplier=await management.supplierSave(demo.tenantId,admin.id,{name:'Proveedor '+suffix,nit:'NIT-'+suffix,contact:'Ana',phone:'3000000000',email:'prov'+suffix+'@example.com',address:'Carrera 1',termsDays:15,active:true});
  ids.supplierId=supplier.id;

  const direct=await prisma.producto.create({data:{tenantId:demo.tenantId,sku:'DIR-'+suffix,nombre:'Producto directo '+suffix,unidadMedida:'UND',controlaInventario:false,stockActual:0,costoPromedio:0,precio1:10000,activo:true}});ids.directProductId=direct.id;
  const directMenu=await prisma.restaurantMenuItem.create({data:{tenantId:demo.tenantId,productId:direct.id,category:'BEBIDAS',station:'BARRA',requiresRecipe:false,active:true,sortOrder:9999}});ids.directMenuItemId=directMenu.id;
  await inventory.configureTracking(demo.tenantId,admin.id,direct.id,true);
  const purchase=await inventory.savePurchase(demo.tenantId,admin.id,{supplierId:supplier.id,supplier:supplier.name,reference:'FAC-'+suffix,purchaseDate:'2026-09-20',paymentTerms:'credit',dueDate:'2026-10-05',notes:'CI gestión',items:[{productId:direct.id,quantity:5,unitCost:4000,taxPercent:0}]});
  assert.equal(purchase.purchase.status,'draft');
  const received=await inventory.receivePurchase(demo.tenantId,admin.id,purchase.purchase.id);
  assert.ok(received.payableId,'credit purchase must create payable');
  const payable=await management.payableDetail(demo.tenantId,received.payableId);
  assert.equal(payable.supplier.id,supplier.id);
  assert.equal(payable.balance,20000);

  const source=fs.readFileSync('src/web/restaurant-v2-management-v1.html','utf8')+fs.readFileSync('src/web/restaurant-v2-management-v1.js','utf8');
  assert.match(source,/Ventas/);
  assert.match(source,/Clientes/);
  assert.match(source,/Proveedores/);
  assert.match(source,/QR de mesas/,'Gestión debe incluir QR de mesas');
  assert.match(source,/\/api\/v1\/restaurante\/qrs/,'Gestión debe cargar los QR físicos reales');
  assert.match(source,/data-regenerate-qr/,'Gestión debe conservar regeneración explícita');
  assert.match(source,/printQrMaterials/,'Gestión debe conservar impresión de QR');
  assert.doesNotMatch(source,/Pedidos QR/i,'Gestión demo must omit Pedidos QR');
  const nativeControl=fs.readFileSync('src/web/restaurant-v2-native-control-p11.js','utf8');
  assert.match(nativeControl,/DEMO_HIDDEN_MODULES = new Set\(\['mesas','division','caja','cierres','qrs'\]\)/,'QR no debe seguir como módulo lateral independiente en demo');
  const invHtml=fs.readFileSync('src/web/restaurant-v2-inventory-bar-v1.html','utf8');
  assert.match(invHtml,/Recetas y costos/);
  assert.match(invHtml,/\+ Ingrediente/);
  const menuEdit=fs.readFileSync('src/modules/restaurant/restaurant-menu-item-edit.service.js','utf8');
  assert.match(menuEdit,/restaurantRecipe/);
  assert.match(menuEdit,/Inventario → Recetas y costos/);

  console.log('RESTAURANT_MANAGEMENT_RECIPES_V1=PASS');
  console.log('GESTION_SUBLEVELS=VENTAS|CLIENTES|PROVEEDORES|QR_MESAS');
  console.log('PEDIDOS_QR_INCLUDED=NO');
  console.log('RECIPE_RESERVATION=PASS');
  console.log('RECIPE_CONSUMPTION=PASS');
  console.log('THEORETICAL_COST=PASS');
  console.log('CREDIT_PURCHASE_PAYABLE=PASS');
 }finally{
  await prisma.restaurantManagementPayablePayment.deleteMany({where:{tenantId:demo.tenantId,payable:{supplierId:ids.supplierId}}}).catch(()=>{});
  await prisma.restaurantManagementPayable.deleteMany({where:{tenantId:demo.tenantId,supplierId:ids.supplierId}}).catch(()=>{});
  await prisma.restaurantInventoryPurchaseItem.deleteMany({where:{tenantId:demo.tenantId,productId:ids.directProductId}}).catch(()=>{});
  await prisma.restaurantInventoryPurchase.deleteMany({where:{tenantId:demo.tenantId,supplierId:ids.supplierId}}).catch(()=>{});
  await prisma.restaurantManagementSupplier.deleteMany({where:{tenantId:demo.tenantId,id:ids.supplierId}}).catch(()=>{});
  await prisma.restaurantManagementCustomer.deleteMany({where:{tenantId:demo.tenantId,document:{contains:suffix}}}).catch(()=>{});
  await prisma.restaurantIngredientMovement.deleteMany({where:{tenantId:demo.tenantId,ingredientId:{in:ids.ingredients||[]}}}).catch(()=>{});
  await prisma.restaurantRecipe.deleteMany({where:{tenantId:demo.tenantId,productId:ids.productId}}).catch(()=>{});
  await prisma.restaurantIngredientStock.deleteMany({where:{tenantId:demo.tenantId,ingredientId:{in:ids.ingredients||[]}}}).catch(()=>{});
  await prisma.restaurantIngredient.deleteMany({where:{tenantId:demo.tenantId,id:{in:ids.ingredients||[]}}}).catch(()=>{});
  await prisma.restaurantInventoryMovement.deleteMany({where:{tenantId:demo.tenantId,productId:ids.directProductId}}).catch(()=>{});
  await prisma.restaurantInventoryStock.deleteMany({where:{tenantId:demo.tenantId,productId:ids.directProductId}}).catch(()=>{});
  if(ids.sessionId){
    const orders=await prisma.restaurantOrder.findMany({where:{tenantId:demo.tenantId,sessionId:ids.sessionId},select:{id:true}}).catch(()=>[]),orderIds=orders.map(x=>x.id);
    if(orderIds.length){await prisma.restaurantCommand.deleteMany({where:{tenantId:demo.tenantId,orderId:{in:orderIds}}}).catch(()=>{});await prisma.restaurantOrderItem.deleteMany({where:{tenantId:demo.tenantId,orderId:{in:orderIds}}}).catch(()=>{});await prisma.restaurantOrder.deleteMany({where:{tenantId:demo.tenantId,id:{in:orderIds}}}).catch(()=>{})}
    await prisma.restaurantTableSession.deleteMany({where:{tenantId:demo.tenantId,id:ids.sessionId}}).catch(()=>{});
  }
  if(ids.saleId){await prisma.detalleComprobante.deleteMany({where:{tenantId:demo.tenantId,comprobanteId:ids.saleId}}).catch(()=>{});await prisma.comprobanteComercial.deleteMany({where:{tenantId:demo.tenantId,id:ids.saleId}}).catch(()=>{})}
  if(ids.menuItemId)await prisma.restaurantMenuItem.deleteMany({where:{tenantId:demo.tenantId,id:ids.menuItemId}}).catch(()=>{});
  if(ids.directMenuItemId)await prisma.restaurantMenuItem.deleteMany({where:{tenantId:demo.tenantId,id:ids.directMenuItemId}}).catch(()=>{});
  if(ids.productId)await prisma.producto.deleteMany({where:{tenantId:demo.tenantId,id:ids.productId}}).catch(()=>{});
  if(ids.directProductId)await prisma.producto.deleteMany({where:{tenantId:demo.tenantId,id:ids.directProductId}}).catch(()=>{});
  if(ids.tableId)await prisma.restaurantTable.deleteMany({where:{tenantId:demo.tenantId,id:ids.tableId}}).catch(()=>{});
  if(ids.zoneId)await prisma.restaurantZone.deleteMany({where:{tenantId:demo.tenantId,id:ids.zoneId}}).catch(()=>{});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
