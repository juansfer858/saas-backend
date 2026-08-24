const crypto=require('node:crypto');
const {prisma}=require('../../config/prisma');
const {AppError}=require('../../utils/app-error');
const restaurant=require('../restaurant/restaurant.service');

const TYPES=new Set(['RESTAURANT_TABLE_OPEN','RESTAURANT_ACCOUNT_REQUEST','RESTAURANT_ORDER_CREATE','RESTAURANT_COMMAND_STATUS','RESTAURANT_CASH_OPEN','RESTAURANT_CASH_CLOSE','RESTAURANT_TABLE_CLOSE']);
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

function actor(agent){return agent.serviceUser||{id:agent.serviceUserId,tenantId:agent.tenantId,rol:'EDGE_AGENT',nombre:`Edge ${agent.pointCode}`}}
function asNum(v){return v==null?null:Number(v)}

async function buildRestaurantBootstrap(agent){
  const tenantId=agent.tenantId;
  const [tables,menu,commands,shifts]=await Promise.all([
    prisma.restaurantTable.findMany({where:{tenantId,active:true},include:{sessions:{where:{state:{in:['ABIERTA','CUENTA_PEDIDA']}},orderBy:{openedAt:'desc'},take:1}},orderBy:{code:'asc'}}),
    restaurant.listMenu(tenantId,{active:true}),
    prisma.restaurantCommand.findMany({where:{tenantId,state:{in:['PENDIENTE','EN_PREPARACION','LISTA']}},include:{order:{include:{items:true,session:{include:{table:true}}}}},orderBy:{creadoEn:'asc'},take:500}),
    prisma.aperturaCierreCaja.findMany({where:{tenantId,estado:'ABIERTA'},orderBy:{abiertoEn:'desc'},take:50})
  ]);
  return {
    generatedAt:new Date().toISOString(),
    tables:tables.map(t=>({id:t.id,code:t.code,name:t.name,seats:t.seats,state:t.state,assignedWaiterId:t.assignedWaiterId,activeSession:t.sessions[0]?{id:t.sessions[0].id,state:t.sessions[0].state,saleId:t.sessions[0].saleId,guestCount:t.sessions[0].guestCount}:null})),
    menu:menu.map(m=>({id:m.id,productId:m.productId,category:m.category,station:m.station,requiresRecipe:m.requiresRecipe,recipeConfigured:m.recipeConfigured,available:Boolean(m.product&&(!m.requiresRecipe||m.recipeConfigured)),product:m.product?{id:m.product.id,sku:m.product.sku,nombre:m.product.nombre,precio1:asNum(m.product.precio1),ivaPct:asNum(m.product.ivaPct),impoconsumoPct:asNum(m.product.impoconsumoPct)}:null})),
    commands:commands.map(c=>({id:c.id,orderId:c.orderId,station:c.station,state:c.state,createdAt:c.creadoEn,table:c.order?.session?.table?{id:c.order.session.table.id,code:c.order.session.table.code,name:c.order.session.table.name}:null,items:(c.order?.items||[]).filter(i=>i.station===c.station).map(i=>({description:i.description,quantity:asNum(i.quantity),notes:i.notes}))})),
    cashShifts:shifts.map(s=>({id:s.id,cajaBancoId:s.cajaBancoId,userId:s.userId,estado:s.estado,saldoInicial:asNum(s.saldoInicial),abiertoEn:s.abiertoEn}))
  };
}

async function execute(agent,operation){
  const p=operation.payload||{},u=actor(agent),tenantId=agent.tenantId;
  switch(operation.type){
    case 'RESTAURANT_TABLE_OPEN': return restaurant.openTable(tenantId,u,p.tableId,{guestCount:p.guestCount||1,customerPhoneE164:p.customerPhoneE164||null});
    case 'RESTAURANT_ACCOUNT_REQUEST': return restaurant.requestAccount(tenantId,u,p.tableId);
    case 'RESTAURANT_ORDER_CREATE': return restaurant.placeWaiterOrder(tenantId,u,p.sessionId,{items:p.items||[],notes:p.notes||null,customerPhoneE164:p.customerPhoneE164||null,externalRequestId:`EDGE-${agent.id}-${operation.id}`});
    case 'RESTAURANT_COMMAND_STATUS': return restaurant.updateCommandState(tenantId,u,p.commandId,p.state);
    case 'RESTAURANT_CASH_OPEN': return restaurant.openCashShift(tenantId,agent.serviceUserId,{cajaBancoId:p.cajaBancoId||agent.defaultCashAccountId,saldoInicial:p.saldoInicial||0});
    case 'RESTAURANT_CASH_CLOSE': return restaurant.closeCashShift(tenantId,agent.serviceUserId,p.shiftId,{saldoFinal:p.saldoFinal});
    case 'RESTAURANT_TABLE_CLOSE': return restaurant.closeTable(tenantId,u,p.tableId,{formaPago:p.formaPago||'EFECTIVO',cajaBancoId:p.cajaBancoId||agent.defaultCashAccountId||null,tipAmount:p.tipAmount||0,split:p.split||{mode:'NONE'}});
    default: throw new AppError(400,`Tipo Restaurante Edge no soportado: ${operation.type}`,'EDGE_RESTAURANT_OPERATION_UNSUPPORTED');
  }
}

function originId(result){return result?.order?.id||result?.session?.id||result?.command?.id||result?.sale?.id||result?.closed?.id||result?.id||null}
async function processOperation(agent,operation){
  if(!operation?.id||!TYPES.has(operation.type)||!operation.localTimestamp||!operation.payload)throw new AppError(400,'Operación Restaurante Edge inválida','EDGE_RESTAURANT_OPERATION_INVALID');
  const payloadHash=hash(operation.payload);let receipt=await prisma.edgeSyncReceipt.findUnique({where:{edgeAgentId_operationId:{edgeAgentId:agent.id,operationId:operation.id}}});
  if(receipt?.state==='SYNCED')return receipt;
  if(receipt&&receipt.payloadHash!==payloadHash)throw new AppError(409,'operationId colisiona con otro payload','EDGE_OPERATION_ID_COLLISION');
  if(!receipt)receipt=await prisma.edgeSyncReceipt.create({data:{tenantId:agent.tenantId,edgeAgentId:agent.id,operationId:operation.id,operationType:operation.type,localTimestamp:new Date(operation.localTimestamp),payloadHash}});
  try{const result=await execute(agent,operation);const id=originId(result);const updated=await prisma.edgeSyncReceipt.update({where:{id:receipt.id},data:{state:'SYNCED',originDocumentId:id,errorCode:null,errorMessage:null,processedAt:new Date()}});await prisma.edgeAgent.update({where:{id:agent.id},data:{lastSyncAt:new Date(),lastSeenAt:new Date()}});return{receipt:updated,result}}
  catch(error){await prisma.edgeSyncReceipt.update({where:{id:receipt.id},data:{state:'FAILED',errorCode:error.code||'EDGE_RESTAURANT_SYNC_ERROR',errorMessage:error.message||String(error),processedAt:new Date()}});throw error}
}
async function processOperations(agent,operations){const ordered=[...(operations||[])].sort((a,b)=>new Date(a.localTimestamp)-new Date(b.localTimestamp)),out=[];for(const op of ordered){try{const r=await processOperation(agent,op);out.push({id:op.id,ok:true,state:'SYNCED',originDocumentId:r.receipt.originDocumentId||null})}catch(e){out.push({id:op?.id||null,ok:false,state:'FAILED',code:e.code||'EDGE_RESTAURANT_SYNC_ERROR',message:e.message||String(e)})}}return out}
module.exports={TYPES,buildRestaurantBootstrap,processOperations};
