'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { lockOperation } = require('./restaurant-operation-lock-v111.service');
const localInventory = require('./restaurant-inventory-bar-v1.service');

const MARKER = 'VANTIX_RESTAURANT_RECIPES_COSTS_V1';
const ACTIVE_SESSIONS = ['ABIERTA','CUENTA_PEDIDA'];
const SENT_ORDERS = ['ENVIADO','EN_PREPARACION','LISTO','ENTREGADO'];

const n=(v)=>{const x=Number(v||0);return Number.isFinite(x)?x:0};
const round3=(v)=>Math.round(n(v)*1000)/1000;
const round4=(v)=>Math.round(n(v)*10000)/10000;
const clean=(v,max,required=true)=>{const s=String(v??'').replace(/\s+/g,' ').trim();if((required&&!s)||s.length>max)throw new AppError(400,'Dato inválido','RESTAURANT_RECIPE_INVALID_TEXT');return s};
const qty=(v,allowZero=false)=>{const x=round3(v);if(!Number.isFinite(x)||x<(allowZero?0:0.001)||x>1000000000)throw new AppError(400,'Cantidad inválida','RESTAURANT_RECIPE_INVALID_QUANTITY');return x};
const cost=(v)=>{const x=round4(v);if(!Number.isFinite(x)||x<0||x>1000000000000)throw new AppError(400,'Costo inválido','RESTAURANT_RECIPE_INVALID_COST');return x};
const serial=(v)=>typeof v==='bigint'?v.toString():v;

async function ingredientForUpdate(tx,tenantId,id){
  const rows=await tx.$queryRawUnsafe('SELECT i.*,s."onHand",s."minimum",s."version" FROM "RestaurantIngredient" i JOIN "RestaurantIngredientStock" s ON s."ingredientId"=i.id WHERE i."tenantId"=$1 AND i.id=$2 FOR UPDATE OF s',tenantId,id);
  return rows?.[0]||null;
}
async function ingredientRow(client,tenantId,id){
  const row=await client.restaurantIngredient.findFirst({where:{id,tenantId},include:{stock:true}});
  if(!row)throw new AppError(404,'Ingrediente no encontrado','RESTAURANT_INGREDIENT_NOT_FOUND');
  return row;
}
async function recipeMap(client,tenantId,{operational=false}={}){
  let productFilter=null;
  if(operational){
    const active=await client.restaurantMenuItem.findMany({where:{tenantId,requiresRecipe:true,active:true},select:{productId:true}});
    productFilter=active.map(x=>x.productId);
    if(!productFilter.length)return {rows:[],byProduct:new Map()};
  }
  const rows=await client.restaurantRecipe.findMany({where:{tenantId,...(productFilter?{productId:{in:productFilter}}:{})},include:{ingredient:true}});
  const byProduct=new Map();
  for(const row of rows){if(!byProduct.has(row.productId))byProduct.set(row.productId,[]);byProduct.get(row.productId).push(row)}
  return {rows,byProduct};
}
async function activeSentItems(client,tenantId){
  const sessions=await client.restaurantTableSession.findMany({where:{tenantId,state:{in:ACTIVE_SESSIONS}},select:{id:true}});
  if(!sessions.length)return[];
  return client.restaurantOrderItem.findMany({
    where:{tenantId,order:{sessionId:{in:sessions.map(x=>x.id)},state:{in:SENT_ORDERS}}},
    select:{id:true,orderId:true,productId:true,quantity:true,description:true,order:{select:{sessionId:true}}}
  });
}
async function reservedByIngredient(client,tenantId){
  const [items,recipes]=await Promise.all([activeSentItems(client,tenantId),recipeMap(client,tenantId,{operational:true})]);
  const result=new Map();
  for(const item of items){
    for(const row of recipes.byProduct.get(item.productId)||[]){
      result.set(row.ingredientId,round3((result.get(row.ingredientId)||0)+n(item.quantity)*n(row.quantity)));
    }
  }
  return result;
}
async function sentProductInUse(client,tenantId,productId){
  const items=await activeSentItems(client,tenantId);
  return items.some(x=>x.productId===productId);
}
async function recordMovement(tx,{tenantId,userId,ingredient,stock,kind,quantity,delta=0,reason,sessionId=null,orderId=null,saleId=null,unitCost=null}){
  const balance=round3(n(stock.onHand)+n(delta));
  if(balance<0)throw new AppError(409,'El saldo de '+ingredient.name+' no puede quedar negativo','RESTAURANT_INGREDIENT_NEGATIVE_STOCK');
  const nextCost=unitCost==null?n(ingredient.unitCost):cost(unitCost);
  const updated=await tx.restaurantIngredientStock.update({where:{id:stock.id},data:{onHand:balance,version:{increment:1}}});
  if(unitCost!=null)await tx.restaurantIngredient.update({where:{id:ingredient.id},data:{unitCost:nextCost}});
  const movement=await tx.restaurantIngredientMovement.create({data:{
    tenantId,ingredientId:ingredient.id,ingredientName:ingredient.name,kind,quantity:qty(Math.abs(quantity)),delta:round3(delta),balance,
    unitCost:nextCost,reason:clean(reason,400),sessionId,orderId,saleId,userId:userId||'SYSTEM'
  }});
  return {stock:updated,movement};
}

async function center(tenantId){
  await localInventory.assertPilot(tenantId);
  const [ingredients,recipes,menu,products,reserved]=await Promise.all([
    prisma.restaurantIngredient.findMany({where:{tenantId},include:{stock:true},orderBy:[{active:'desc'},{name:'asc'}]}),
    prisma.restaurantRecipe.findMany({where:{tenantId},include:{ingredient:true},orderBy:[{productId:'asc'},{ingredientId:'asc'}]}),
    prisma.restaurantMenuItem.findMany({where:{tenantId},orderBy:[{active:'desc'},{sortOrder:'asc'}]}),
    prisma.producto.findMany({where:{tenantId,activo:true},select:{id:true,sku:true,nombre:true,precio1:true}}),
    reservedByIngredient(prisma,tenantId)
  ]);
  const productById=new Map(products.map(x=>[x.id,x]));
  const recipesByProduct=new Map();
  for(const r of recipes){if(!recipesByProduct.has(r.productId))recipesByProduct.set(r.productId,[]);recipesByProduct.get(r.productId).push(r)}
  const ingredientRows=ingredients.map(i=>{
    const held=reserved.get(i.id)||0,onHand=n(i.stock?.onHand);
    return{id:i.id,code:i.code,name:i.name,unit:i.unit,unitCost:n(i.unitCost),active:i.active,onHand,minimum:n(i.stock?.minimum),stockVersion:Number(i.stock?.version||1),reserved:held,available:round3(onHand-held)};
  });
  const productRows=menu.map(m=>{
    const p=productById.get(m.productId);if(!p)return null;
    const rr=recipesByProduct.get(m.productId)||[];
    return{id:p.id,menuItemId:m.id,sku:p.sku,name:p.nombre,price:n(p.precio1),active:m.active!==false,hasRecipe:rr.length>0,recipeCost:round4(rr.reduce((sum,r)=>sum+n(r.quantity)*n(r.ingredient.unitCost),0)),margin:round4(n(p.precio1)-rr.reduce((sum,r)=>sum+n(r.quantity)*n(r.ingredient.unitCost),0)),ingredients:rr.map(r=>({ingredientId:r.ingredientId,ingredientName:r.ingredient.name,unit:r.ingredient.unit,unitCost:n(r.ingredient.unitCost),quantity:n(r.quantity),lineCost:round4(n(r.quantity)*n(r.ingredient.unitCost))}))};
  }).filter(Boolean);
  return{marker:MARKER,ingredients:ingredientRows,products:productRows,recipes:recipes.map(r=>({id:r.id,productId:r.productId,ingredientId:r.ingredientId,quantity:n(r.quantity),lineCost:round4(n(r.quantity)*n(r.ingredient.unitCost))}))};
}

async function saveIngredient(tenantId,userId,input){
  await localInventory.assertPilot(tenantId);
  return prisma.$transaction(async tx=>{
    await lockOperation(tx,tenantId);
    const code=clean(input.code,40).toUpperCase(),name=clean(input.name,120),unit=['g','ml','unidad'].includes(input.unit)?input.unit:null;
    if(!unit)throw new AppError(400,'Unidad inválida','RESTAURANT_INGREDIENT_UNIT_INVALID');
    const unitCost=cost(input.unitCost||0),active=input.active!==false;
    if(input.id){
      const current=await ingredientRow(tx,tenantId,input.id);
      const duplicate=await tx.restaurantIngredient.findFirst({where:{tenantId,code:{equals:code,mode:'insensitive'},id:{not:current.id}}});
      if(duplicate)throw new AppError(409,'Ya existe un ingrediente con ese código','RESTAURANT_INGREDIENT_CODE_DUPLICATE');
      const row=await tx.restaurantIngredient.update({where:{id:current.id},data:{code,name,unit,unitCost,active}});
      return{marker:MARKER,ingredient:row};
    }
    const duplicate=await tx.restaurantIngredient.findFirst({where:{tenantId,code:{equals:code,mode:'insensitive'}}});
    if(duplicate)throw new AppError(409,'Ya existe un ingrediente con ese código','RESTAURANT_INGREDIENT_CODE_DUPLICATE');
    const row=await tx.restaurantIngredient.create({data:{tenantId,code,name,unit,unitCost,active,stock:{create:{tenantId}}},include:{stock:true}});
    return{marker:MARKER,ingredient:row};
  });
}
async function ingredientMinimum(tenantId,userId,input){
  await localInventory.assertPilot(tenantId);
  return prisma.$transaction(async tx=>{
    await lockOperation(tx,tenantId);
    const row=await ingredientForUpdate(tx,tenantId,input.id);if(!row)throw new AppError(404,'Ingrediente no encontrado','RESTAURANT_INGREDIENT_NOT_FOUND');
    if(Number(input.version)!==Number(row.version))throw new AppError(409,'El inventario del ingrediente cambió. Actualiza antes de guardar.','RESTAURANT_INGREDIENT_VERSION_CONFLICT');
    const updated=await tx.restaurantIngredientStock.update({where:{id:row.id},data:{minimum:qty(input.minimum,true),version:{increment:1}}});
    return{marker:MARKER,minimum:n(updated.minimum),version:updated.version};
  });
}
async function ingredientMove(tenantId,userId,input){
  await localInventory.assertPilot(tenantId);
  return prisma.$transaction(async tx=>{
    await lockOperation(tx,tenantId);
    const row=await ingredientForUpdate(tx,tenantId,input.id);if(!row)throw new AppError(404,'Ingrediente no encontrado','RESTAURANT_INGREDIENT_NOT_FOUND');
    if(Number(input.version)!==Number(row.version))throw new AppError(409,'El inventario del ingrediente cambió. Actualiza antes de guardar.','RESTAURANT_INGREDIENT_VERSION_CONFLICT');
    const kind=input.kind;if(!['initial','entry','exit','adjustment'].includes(kind))throw new AppError(400,'Movimiento inválido','RESTAURANT_INGREDIENT_MOVEMENT_INVALID');
    const amount=qty(input.quantity,['initial','adjustment'].includes(kind)),reason=clean(input.reason,400),held=(await reservedByIngredient(tx,tenantId)).get(row.id)||0;
    if(kind==='initial'){
      const has=await tx.restaurantIngredientMovement.findFirst({where:{tenantId,ingredientId:row.id,delta:{not:0}},select:{id:true}});
      if(n(row.onHand)!==0||has)throw new AppError(409,'Ya existen movimientos. Usa Entrada o Conteo físico.','RESTAURANT_INGREDIENT_INITIAL_ALREADY_SET');
    }
    const delta=['initial','adjustment'].includes(kind)?round3(amount-n(row.onHand)):kind==='entry'?amount:-amount;
    if(Math.abs(delta)<0.0001)throw new AppError(409,'El conteo coincide con el saldo.','RESTAURANT_INGREDIENT_NO_CHANGE');
    if(n(row.onHand)+delta<held-0.0001)throw new AppError(409,'Hay '+held+' '+row.unit+' reservados en pedidos abiertos.','RESTAURANT_INGREDIENT_RESERVED_FLOOR');
    const ingredient={id:row.id,name:row.name,unitCost:row.unitCost};
    return{marker:MARKER,...await recordMovement(tx,{tenantId,userId,ingredient,stock:row,kind,quantity:Math.abs(delta),delta,reason,unitCost:kind==='entry'&&input.unitCost!==undefined?input.unitCost:null})};
  });
}
async function ingredientHistory(tenantId,filters={}){
  await localInventory.assertPilot(tenantId);
  const where={tenantId};if(filters.ingredientId)where.ingredientId=String(filters.ingredientId);
  if(filters.from||filters.to){if(!/^\d{4}-\d{2}-\d{2}$/.test(filters.from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(filters.to||'')||filters.from>filters.to)throw new AppError(400,'Selecciona un período válido','RESTAURANT_INGREDIENT_HISTORY_PERIOD_INVALID');where.creadoEn={gte:new Date(filters.from+'T05:00:00.000Z'),lt:new Date(new Date(filters.to+'T05:00:00.000Z').getTime()+86400000)}}
  const rows=await prisma.restaurantIngredientMovement.findMany({where,orderBy:{number:'desc'},take:5000});
  return rows.map(r=>({...r,number:serial(r.number),quantity:n(r.quantity),delta:n(r.delta),balance:n(r.balance),unitCost:n(r.unitCost)}));
}
async function saveRecipe(tenantId,userId,productId,items){
  await localInventory.assertPilot(tenantId);
  return prisma.$transaction(async tx=>{
    await lockOperation(tx,tenantId);
    const [product,menuItem]=await Promise.all([tx.producto.findFirst({where:{id:productId,tenantId,activo:true}}),tx.restaurantMenuItem.findFirst({where:{tenantId,productId}})]);
    if(!product||!menuItem)throw new AppError(404,'Producto de Carta no encontrado','RESTAURANT_RECIPE_PRODUCT_NOT_FOUND');
    if(await sentProductInUse(tx,tenantId,productId))throw new AppError(409,'Resuelve los pedidos enviados de este producto antes de cambiar la receta.','RESTAURANT_RECIPE_PRODUCT_IN_USE');
    if(!Array.isArray(items)||!items.length||items.length>100)throw new AppError(400,'Agrega entre 1 y 100 ingredientes a la receta.','RESTAURANT_RECIPE_ITEMS_REQUIRED');
    const direct=await tx.restaurantInventoryStock.findUnique({where:{tenantId_productId:{tenantId,productId}}});
    const directHeld=(await localInventory.workspace(tenantId,tx)).products.find(x=>x.productId===productId)?.reserved||0;
    if(direct?.enabled&&(n(direct.onHand)>0||directHeld>0))throw new AppError(409,'Este producto todavía tiene existencias o reservas como terminado. Déjalas en cero antes de pasarlo a receta.','RESTAURANT_RECIPE_DIRECT_STOCK_EXISTS');
    if(direct?.enabled)await localInventory.configureTrackingInTx(tx,tenantId,userId,productId,false);
    const seen=new Set(),normalized=[];
    for(const raw of items){const id=String(raw.ingredientId||'');if(seen.has(id))throw new AppError(409,'No repitas ingredientes en la receta.','RESTAURANT_RECIPE_DUPLICATE_INGREDIENT');seen.add(id);const ingredient=await ingredientRow(tx,tenantId,id);if(!ingredient.active)throw new AppError(409,'Activa el ingrediente '+ingredient.name+' antes de usarlo.','RESTAURANT_RECIPE_INGREDIENT_INACTIVE');normalized.push({ingredientId:id,quantity:qty(raw.quantity)})}
    await tx.restaurantRecipe.deleteMany({where:{tenantId,productId}});
    for(const row of normalized)await tx.restaurantRecipe.create({data:{tenantId,productId,ingredientId:row.ingredientId,quantity:row.quantity}});
    await tx.restaurantMenuItem.update({where:{id:menuItem.id},data:{requiresRecipe:true}});
    await tx.producto.update({where:{id:product.id},data:{controlaInventario:false}});
    await tx.consumptionRecipe.updateMany({where:{tenantId,outputProductId:productId,active:true},data:{active:false}}).catch(()=>{});
    return{marker:MARKER,productId,ingredients:normalized.length};
  });
}
async function clearRecipe(tenantId,userId,productId){
  await localInventory.assertPilot(tenantId);
  return prisma.$transaction(async tx=>{
    await lockOperation(tx,tenantId);
    const menuItem=await tx.restaurantMenuItem.findFirst({where:{tenantId,productId}});if(!menuItem)throw new AppError(404,'Producto de Carta no encontrado','RESTAURANT_RECIPE_PRODUCT_NOT_FOUND');
    if(await sentProductInUse(tx,tenantId,productId))throw new AppError(409,'Resuelve los pedidos enviados antes de quitar la receta.','RESTAURANT_RECIPE_PRODUCT_IN_USE');
    await tx.restaurantRecipe.deleteMany({where:{tenantId,productId}});
    await tx.restaurantMenuItem.update({where:{id:menuItem.id},data:{requiresRecipe:false}});
    return{marker:MARKER,productId,cleared:true};
  });
}
async function assertItemsAvailableInTx(tx,tenantId,items){
  await localInventory.assertPilot(tenantId,tx);
  const recipes=await recipeMap(tx,tenantId,{operational:true}),reserved=await reservedByIngredient(tx,tenantId),needs=new Map();
  for(const item of items||[])for(const r of recipes.byProduct.get(item.productId)||[])needs.set(r.ingredientId,round3((needs.get(r.ingredientId)||0)+n(item.quantity)*n(r.quantity)));
  for(const [ingredientId,need] of needs){
    const row=await ingredientRow(tx,tenantId,ingredientId),available=round3(n(row.stock?.onHand)-(reserved.get(ingredientId)||0));
    if(need>available+0.0001)throw new AppError(409,'Ingrediente insuficiente para el pedido: '+row.name+' tiene '+available+' '+row.unit+' disponibles y se requieren '+need+'.','RESTAURANT_RECIPE_INGREDIENT_INSUFFICIENT');
  }
  return{checked:needs.size};
}
async function recordReservationsInTx(tx,tenantId,userId,sessionId,orderId,items){
  const recipes=await recipeMap(tx,tenantId,{operational:true}),needs=new Map();
  for(const item of items||[])for(const r of recipes.byProduct.get(item.productId)||[])needs.set(r.ingredientId,{quantity:round3((needs.get(r.ingredientId)?.quantity||0)+n(item.quantity)*n(r.quantity)),productNames:[...(needs.get(r.ingredientId)?.productNames||[]),item.description]});
  for(const [ingredientId,info] of needs){
    const exists=await tx.restaurantIngredientMovement.findFirst({where:{tenantId,orderId,ingredientId,kind:'reserve'},select:{id:true}});if(exists)continue;
    const row=await ingredientForUpdate(tx,tenantId,ingredientId);if(!row)throw new AppError(404,'Ingrediente no encontrado','RESTAURANT_INGREDIENT_NOT_FOUND');
    await recordMovement(tx,{tenantId,userId,ingredient:{id:row.id,name:row.name,unitCost:row.unitCost},stock:row,kind:'reserve',quantity:info.quantity,delta:0,reason:'Reserva de receta · '+[...new Set(info.productNames)].join(', '),sessionId,orderId});
  }
}
async function consumeSaleInTx(tx,tenantId,userId,sessionId,saleId){
  await localInventory.assertPilot(tenantId,tx);
  const prior=await tx.restaurantIngredientMovement.findFirst({where:{tenantId,saleId,kind:'sale'},select:{id:true}});if(prior)return{consumed:false,alreadyConsumed:true,totalCost:0};
  const details=await tx.detalleComprobante.findMany({where:{tenantId,comprobanteId:saleId},select:{productoId:true,cantidad:true}});
  const recipes=await recipeMap(tx,tenantId,{operational:true}),needs=new Map();
  for(const d of details)for(const r of recipes.byProduct.get(d.productoId)||[])needs.set(r.ingredientId,round3((needs.get(r.ingredientId)||0)+n(d.cantidad)*n(r.quantity)));
  let totalCost=0;
  for(const [ingredientId,amount] of needs){
    const row=await ingredientForUpdate(tx,tenantId,ingredientId);if(!row)throw new AppError(404,'Ingrediente no encontrado','RESTAURANT_INGREDIENT_NOT_FOUND');
    if(amount>n(row.onHand)+0.0001)throw new AppError(409,'Ingrediente insuficiente al cobrar: '+row.name+'. Revisa inventario.','RESTAURANT_RECIPE_INGREDIENT_INSUFFICIENT_AT_PAYMENT');
    totalCost+=amount*n(row.unitCost);
    await recordMovement(tx,{tenantId,userId,ingredient:{id:row.id,name:row.name,unitCost:row.unitCost},stock:row,kind:'sale',quantity:amount,delta:-amount,reason:'Cobro de cuenta',sessionId,saleId});
  }
  return{consumed:true,ingredients:needs.size,totalCost:round4(totalCost)};
}

module.exports={MARKER,center,saveIngredient,ingredientMinimum,ingredientMove,ingredientHistory,saveRecipe,clearRecipe,assertItemsAvailableInTx,recordReservationsInTx,consumeSaleInTx};
