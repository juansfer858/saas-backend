'use strict';

const crypto=require('node:crypto');
const {prisma}=require('../../config/prisma');
const {AppError}=require('../../utils/app-error');
const {money}=require('../../utils/decimal');
const {lockOperation}=require('./restaurant-operation-lock-v111.service');
const localInventory=require('./restaurant-inventory-bar-v1.service');
const treasuryIntegration=require('../treasury/treasury-integration.service');

const MARKER='VANTIX_RESTAURANT_MANAGEMENT_V1';
const DOC_TYPES=new Set(['','CC','NIT','CE','Pasaporte','Otro']);
const PAYMENT_METHODS=new Set(['EFECTIVO','TRANSFERENCIA','TARJETA']);
const n=v=>{const x=Number(v||0);return Number.isFinite(x)?x:0};
const serial=v=>typeof v==='bigint'?v.toString():v;
const clean=(v,max,required=false)=>{const s=String(v??'').replace(/\s+/g,' ').trim();if((required&&!s)||s.length>max)throw new AppError(400,'Dato inválido','RESTAURANT_MANAGEMENT_INVALID_TEXT');return s};
function day(value,label='Fecha'){const s=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new AppError(400,label+' inválida','RESTAURANT_MANAGEMENT_INVALID_DATE');return s}
function window(from,to){const a=day(from,'Fecha inicial'),b=day(to,'Fecha final');if(a>b)throw new AppError(400,'El período es inválido','RESTAURANT_MANAGEMENT_INVALID_PERIOD');return{gte:new Date(a+'T05:00:00.000Z'),lt:new Date(new Date(b+'T05:00:00.000Z').getTime()+86400000)}}

async function customerList(tenantId,q=''){
  await localInventory.assertPilot(tenantId);
  const search=clean(q,160,false),where={tenantId,active:true};
  if(search)where.OR=[{name:{contains:search,mode:'insensitive'}},{document:{contains:search,mode:'insensitive'}},{phone:{contains:search,mode:'insensitive'}},{email:{contains:search,mode:'insensitive'}}];
  return prisma.restaurantManagementCustomer.findMany({where,orderBy:{name:'asc'},take:100});
}
async function customerSave(tenantId,userId,input){
  await localInventory.assertPilot(tenantId);
  return prisma.$transaction(async tx=>{
    await lockOperation(tx,tenantId);
    const name=clean(input.name,160,true),documentType=clean(input.documentType,30,false),document=clean(input.document,80,false),phone=clean(input.phone,80,false),email=clean(input.email,160,false),address=clean(input.address,200,false);
    if(!DOC_TYPES.has(documentType))throw new AppError(400,'Tipo de documento inválido','RESTAURANT_MANAGEMENT_CUSTOMER_DOCUMENT_TYPE');
    if(document&&!documentType)throw new AppError(400,'Selecciona el tipo de documento','RESTAURANT_MANAGEMENT_CUSTOMER_DOCUMENT_TYPE_REQUIRED');
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AppError(400,'Correo inválido','RESTAURANT_MANAGEMENT_CUSTOMER_EMAIL_INVALID');
    if(document){
      const dup=await tx.restaurantManagementCustomer.findFirst({where:{tenantId,documentType,document:{equals:document,mode:'insensitive'},...(input.id?{id:{not:input.id}}:{})}});
      if(dup)throw new AppError(409,'Ya existe un cliente con ese documento','RESTAURANT_MANAGEMENT_CUSTOMER_DUPLICATE');
    }
    if(input.id){
      const current=await tx.restaurantManagementCustomer.findFirst({where:{id:input.id,tenantId}});
      if(!current)throw new AppError(404,'Cliente no encontrado','RESTAURANT_MANAGEMENT_CUSTOMER_NOT_FOUND');
      if(Number(input.version)!==Number(current.version))throw new AppError(409,'El cliente cambió. Actualiza y vuelve a editar.','RESTAURANT_MANAGEMENT_CUSTOMER_VERSION');
      return tx.restaurantManagementCustomer.update({where:{id:current.id},data:{name,documentType,document,phone,email,address,version:{increment:1}}});
    }
    return tx.restaurantManagementCustomer.create({data:{tenantId,name,documentType,document,phone,email,address}});
  });
}

async function supplierCenter(tenantId){
  await localInventory.assertPilot(tenantId);
  const [suppliers,payables]=await Promise.all([
    prisma.restaurantManagementSupplier.findMany({where:{tenantId},orderBy:[{active:'desc'},{name:'asc'}]}),
    prisma.restaurantManagementPayable.findMany({where:{tenantId},include:{supplier:true,payments:true},orderBy:[{status:'asc'},{dueDate:'asc'},{creadoEn:'desc'}],take:1000})
  ]);
  const bySupplier=new Map();
  for(const p of payables)if(p.status==='open'){const s=bySupplier.get(p.supplierId)||{openCount:0,balance:0};s.openCount+=1;s.balance+=n(p.balance);bySupplier.set(p.supplierId,s)}
  return{
    suppliers:suppliers.map(s=>({...s,openCount:bySupplier.get(s.id)?.openCount||0,balance:bySupplier.get(s.id)?.balance||0})),
    payables:payables.map(p=>({id:p.id,number:serial(p.number),supplierId:p.supplierId,supplierName:p.supplier.name,nit:p.supplier.nit,purchaseId:p.purchaseId,document:p.document,issueDate:p.issueDate,dueDate:p.dueDate,total:n(p.total),balance:n(p.balance),status:p.status,paid:p.payments.reduce((sum,x)=>sum+n(x.amount),0),createdAt:p.creadoEn}))
  };
}
async function supplierSave(tenantId,userId,input){
  await localInventory.assertPilot(tenantId);
  return prisma.$transaction(async tx=>{
    await lockOperation(tx,tenantId);
    const name=clean(input.name,160,true),nit=clean(input.nit,60,false),contact=clean(input.contact,200,false),phone=clean(input.phone,80,false),email=clean(input.email,160,false),address=clean(input.address,200,false),termsDays=Number(input.termsDays||0),active=input.active!==false;
    if(!Number.isInteger(termsDays)||termsDays<0||termsDays>3650)throw new AppError(400,'Plazo inválido','RESTAURANT_MANAGEMENT_SUPPLIER_TERMS');
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AppError(400,'Correo inválido','RESTAURANT_MANAGEMENT_SUPPLIER_EMAIL');
    if(nit){const dup=await tx.restaurantManagementSupplier.findFirst({where:{tenantId,nit:{equals:nit,mode:'insensitive'},...(input.id?{id:{not:input.id}}:{})}});if(dup)throw new AppError(409,'Ya existe un proveedor con ese NIT','RESTAURANT_MANAGEMENT_SUPPLIER_DUPLICATE')}
    if(input.id){
      const row=await tx.restaurantManagementSupplier.findFirst({where:{id:input.id,tenantId}});if(!row)throw new AppError(404,'Proveedor no encontrado','RESTAURANT_MANAGEMENT_SUPPLIER_NOT_FOUND');
      if(!active){const open=await tx.restaurantManagementPayable.findFirst({where:{tenantId,supplierId:row.id,status:'open',balance:{gt:0}}});if(open)throw new AppError(409,'Este proveedor tiene cuentas pendientes','RESTAURANT_MANAGEMENT_SUPPLIER_OPEN_PAYABLES')}
      return tx.restaurantManagementSupplier.update({where:{id:row.id},data:{name,nit,contact,phone,email,address,termsDays,active}});
    }
    return tx.restaurantManagementSupplier.create({data:{tenantId,name,nit,contact,phone,email,address,termsDays,active}});
  });
}
async function supplierToggle(tenantId,userId,id,active){
  await localInventory.assertPilot(tenantId);
  return prisma.$transaction(async tx=>{
    await lockOperation(tx,tenantId);
    const row=await tx.restaurantManagementSupplier.findFirst({where:{id,tenantId}});if(!row)throw new AppError(404,'Proveedor no encontrado','RESTAURANT_MANAGEMENT_SUPPLIER_NOT_FOUND');
    if(!active){const open=await tx.restaurantManagementPayable.findFirst({where:{tenantId,supplierId:id,status:'open',balance:{gt:0}}});if(open)throw new AppError(409,'Este proveedor tiene cuentas pendientes','RESTAURANT_MANAGEMENT_SUPPLIER_OPEN_PAYABLES')}
    return tx.restaurantManagementSupplier.update({where:{id},data:{active:Boolean(active)}});
  });
}
async function payableDetail(tenantId,id){
  await localInventory.assertPilot(tenantId);
  const p=await prisma.restaurantManagementPayable.findFirst({where:{id,tenantId},include:{supplier:true,payments:{orderBy:{creadoEn:'asc'}}}});
  if(!p)throw new AppError(404,'Cuenta por pagar no encontrada','RESTAURANT_MANAGEMENT_PAYABLE_NOT_FOUND');
  return{id:p.id,number:serial(p.number),supplier:p.supplier,document:p.document,issueDate:p.issueDate,dueDate:p.dueDate,total:n(p.total),balance:n(p.balance),status:p.status,payments:p.payments.map(x=>({...x,amount:n(x.amount)}))};
}
async function createPayableForPurchaseInTx(tx,tenantId,purchase){
  if(purchase.paymentTerms!=='credit'||!purchase.supplierId)return null;
  const existing=await tx.restaurantManagementPayable.findFirst({where:{purchaseId:purchase.id}});if(existing)return existing.id;
  const supplier=await tx.restaurantManagementSupplier.findFirst({where:{id:purchase.supplierId,tenantId,active:true}});if(!supplier)throw new AppError(409,'Proveedor no disponible para crédito','RESTAURANT_MANAGEMENT_SUPPLIER_REQUIRED');
  const due=purchase.dueDate||purchase.purchaseDate;
  const p=await tx.restaurantManagementPayable.create({data:{tenantId,supplierId:supplier.id,purchaseId:purchase.id,document:purchase.reference||('Compra #'+serial(purchase.number)),issueDate:purchase.purchaseDate,dueDate:due,total:purchase.total,balance:purchase.total}});
  return p.id;
}
async function payablePay(tenantId,userId,id,input){
  await localInventory.assertPilot(tenantId);
  const p=await prisma.restaurantManagementPayable.findFirst({where:{id,tenantId},include:{supplier:true}});
  if(!p)throw new AppError(404,'Cuenta por pagar no encontrada','RESTAURANT_MANAGEMENT_PAYABLE_NOT_FOUND');
  if(p.status!=='open'||n(p.balance)<=0)throw new AppError(409,'Esta cuenta ya no tiene saldo pendiente','RESTAURANT_MANAGEMENT_PAYABLE_CLOSED');
  const amount=money(input.amount);if(!amount.gt(0)||amount.gt(money(p.balance)))throw new AppError(400,'Valor de pago inválido','RESTAURANT_MANAGEMENT_PAYABLE_AMOUNT');
  const method=String(input.method||'').toUpperCase();if(!PAYMENT_METHODS.has(method))throw new AppError(400,'Medio de pago inválido','RESTAURANT_MANAGEMENT_PAYABLE_METHOD');
  const accountId=String(input.cajaBancoId||'');if(!accountId)throw new AppError(400,'Selecciona la cuenta de pago','RESTAURANT_MANAGEMENT_PAYABLE_ACCOUNT');
  if(method==='EFECTIVO'){
    const shift=await prisma.aperturaCierreCaja.findFirst({where:{tenantId,userId,estado:'ABIERTA',cajaBancoId:accountId}});
    if(!shift)throw new AppError(409,'Abre tu turno en esa caja antes de pagar en efectivo','RESTAURANT_MANAGEMENT_PAYABLE_SHIFT_REQUIRED');
  }
  const paymentId=crypto.randomUUID(),sourceId='MGMT-PAYABLE-'+paymentId;
  const expense=await treasuryIntegration.directExpense(tenantId,userId,{cajaBancoId:accountId,monto:amount,concepto:'Pago proveedor · '+p.supplier.name+' · '+(p.document||('Cuenta #'+serial(p.number))),fecha:new Date(),sourceId});
  return prisma.$transaction(async tx=>{
    await lockOperation(tx,tenantId);
    const current=await tx.restaurantManagementPayable.findFirst({where:{id,tenantId}});if(!current||current.status!=='open')throw new AppError(409,'La cuenta cambió durante el pago','RESTAURANT_MANAGEMENT_PAYABLE_CONFLICT');
    const next=money(current.balance).minus(amount);if(next.lt(0))throw new AppError(409,'El pago supera el saldo actual','RESTAURANT_MANAGEMENT_PAYABLE_CONFLICT');
    await tx.restaurantManagementPayablePayment.create({data:{id:paymentId,tenantId,payableId:id,amount,method,note:clean(input.note,300,false),shiftId:method==='EFECTIVO'?(await tx.aperturaCierreCaja.findFirst({where:{tenantId,userId,estado:'ABIERTA',cajaBancoId:accountId},select:{id:true}}))?.id:null,userId}});
    await tx.restaurantManagementPayable.update({where:{id},data:{balance:next,status:next.eq(0)?'paid':'open'}});
    return{marker:MARKER,balance:Number(next),status:next.eq(0)?'paid':'open',expenseDocumentId:expense.documento.id};
  });
}
async function payableVoid(tenantId,userId,id){
  await localInventory.assertPilot(tenantId);
  return prisma.$transaction(async tx=>{
    await lockOperation(tx,tenantId);
    const p=await tx.restaurantManagementPayable.findFirst({where:{id,tenantId},include:{payments:true}});if(!p)throw new AppError(404,'Cuenta por pagar no encontrada','RESTAURANT_MANAGEMENT_PAYABLE_NOT_FOUND');
    if(p.payments.length)throw new AppError(409,'No puedes anular una cuenta con pagos registrados','RESTAURANT_MANAGEMENT_PAYABLE_HAS_PAYMENTS');
    return tx.restaurantManagementPayable.update({where:{id},data:{status:'void',balance:0}});
  });
}

async function sales(tenantId,from,to){
  await localInventory.assertPilot(tenantId);
  const w=window(from,to);
  const sessions=await prisma.restaurantTableSession.findMany({where:{tenantId,state:'CERRADA',closedAt:w},select:{id:true,saleId:true,closedAt:true,paymentMethodLabel:true,table:{select:{name:true,code:true}}}});
  const deliveries=await prisma.restaurantDeliveryOrder.findMany({where:{tenantId,paymentStatus:'PAGADO'},select:{saleId:true,code:true,customerName:true}}).catch(()=>[]);
  const context=new Map();
  for(const s of sessions)context.set(s.saleId,{channel:'Mesa',name:s.table?.name||'Mesa',at:s.closedAt,method:s.paymentMethodLabel||null});
  for(const d of deliveries)if(d.saleId)context.set(d.saleId,{channel:'Domicilio',name:'Domicilio '+d.code+(d.customerName?' · '+d.customerName:''),at:null,method:null});
  const ids=[...context.keys()];if(!ids.length)return{marker:MARKER,rows:[],summary:{sales:0,total:0,products:[]}};
  const docs=await prisma.comprobanteComercial.findMany({where:{tenantId,id:{in:ids},tipo:'FACTURA_VENTA',estado:{not:'ANULADO'},emitidoEn:w},include:{tercero:true,detalles:true},orderBy:{emitidoEn:'asc'}});
  const products=new Map(),rows=[];
  for(const sale of docs){
    const ctx=context.get(sale.id)||{},detail=sale.detalles.map(l=>({productId:l.productoId,name:l.descripcion,qty:n(l.cantidad),price:n(l.precioUnitario),total:n(l.totalLinea)}));
    for(const l of detail){const p=products.get(l.productId)||{name:l.name,qty:0,total:0};p.qty+=l.qty;p.total+=l.total;products.set(l.productId,p)}
    rows.push({id:sale.id,number:sale.numero,created:sale.emitidoEn||sale.fecha,name:ctx.name||'Venta',channel:ctx.channel||'Restaurante',customer:sale.tercero?.razonSocial||sale.tercero?.nombre||'Cliente genérico',paymentMethod:ctx.method||sale.formaPago,total:n(sale.total),detail:{lines:detail}});
  }
  return{marker:MARKER,rows,summary:{sales:rows.length,total:rows.reduce((sum,r)=>sum+r.total,0),products:[...products.values()].sort((a,b)=>b.qty-a.qty)}};
}

async function paymentContext(tenantId,userId){
  await localInventory.assertPilot(tenantId);
  const [shift,banks]=await Promise.all([
    prisma.aperturaCierreCaja.findFirst({where:{tenantId,userId,estado:'ABIERTA'},include:{cajaBanco:true},orderBy:{abiertoEn:'desc'}}),
    prisma.cajaBanco.findMany({where:{tenantId,activo:true,tipo:'BANCO'},orderBy:{nombre:'asc'}})
  ]);
  return{cash:shift?.cajaBanco?.tipo==='CAJA'?{id:shift.cajaBanco.id,name:shift.cajaBanco.nombre}:null,banks:banks.map(x=>({id:x.id,name:x.nombre}))};
}

module.exports={MARKER,customerList,customerSave,supplierCenter,supplierSave,supplierToggle,payableDetail,payablePay,payableVoid,createPayableForPurchaseInTx,sales,paymentContext};
