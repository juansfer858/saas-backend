'use strict';

const express=require('express');
const { z }=require('zod');
const { prisma }=require('../../config/prisma');
const { AppError }=require('../../utils/app-error');
const { requirePermission }=require('../../middleware/require-permission');
const base=require('./restaurant.service');
const identity=require('./restaurant-identity.service');
const kdsPush=require('./restaurant-v2-kds-push.service');

const router=express.Router();
const V2_OPTIONS=Object.freeze({sharedFloor:true,optionalSeat:true});

function parse(schema,value){const result=schema.safeParse(value||{});if(!result.success)throw new AppError(400,'Datos de Pedido V2 inválidos','VALIDATION_ERROR',result.error.flatten());return result.data}
const openSchema=z.object({guestCount:z.coerce.number().int().min(1).max(50).default(1)});
const qtySchema=z.object({quantity:z.coerce.number().min(0).max(999),seatNumber:z.coerce.number().int().min(1).max(50).nullable().optional()});
const metaSchema=z.object({seatNumber:z.coerce.number().int().min(1).max(50).nullable().optional(),notes:z.string().trim().max(300).nullable().optional()}).refine(x=>Object.keys(x).length>0,{message:'Debe enviar al menos un cambio'});
const peopleSchema=z.object({guestCount:z.coerce.number().int().min(1).max(50)});

async function listTablesV2(tenantId,user){
  const tables=await base.listTables(tenantId,user,V2_OPTIONS);
  const saleIds=[...new Set(tables.map(row=>row.activeSession?.saleId).filter(Boolean))];
  const sales=saleIds.length?await prisma.comprobanteComercial.findMany({
    where:{tenantId,id:{in:saleIds}},
    select:{id:true,numero:true,estado:true,total:true,fecha:true,creadoEn:true}
  }):[];
  const bySale=new Map(sales.map(row=>[row.id,row]));
  return tables.map(table=>{
    const session=table.activeSession;
    if(!session)return table;
    const sale=bySale.get(session.saleId)||null;
    return {...table,activeSession:{...session,sale:sale?{id:sale.id,numero:sale.numero,estado:sale.estado,total:sale.total,fecha:sale.fecha,creadoEn:sale.creadoEn}:null}};
  });
}

router.get('/v2/mesas',requirePermission('MESAS.VER'),async(req,res,next)=>{try{res.json({ok:true,data:await listTablesV2(req.tenantId,req.user)})}catch(error){next(error)}});
router.post('/v2/mesas/:id/abrir',requirePermission('MESAS.CREAR'),async(req,res,next)=>{try{const input=parse(openSchema,req.body);res.status(201).json({ok:true,data:await base.openTable(req.tenantId,req.user,req.params.id,{guestCount:input.guestCount},V2_OPTIONS)})}catch(error){next(error)}});
router.post('/v2/mesas/:id/pedir-cuenta',requirePermission('MESAS.EDITAR'),async(req,res,next)=>{try{res.json({ok:true,data:await base.requestAccount(req.tenantId,req.user,req.params.id,V2_OPTIONS)})}catch(error){next(error)}});
router.get('/v2/sesiones/:sessionId/pedido',requirePermission('PEDIDOS.VER'),async(req,res,next)=>{try{res.json({ok:true,data:await identity.getWaiterDraft(req.tenantId,req.user,req.params.sessionId,V2_OPTIONS)})}catch(error){next(error)}});
router.put('/v2/sesiones/:sessionId/pedido/items/:menuItemId',requirePermission('PEDIDOS.CREAR'),async(req,res,next)=>{try{const input=parse(qtySchema,req.body);res.json({ok:true,data:await identity.setWaiterDraftItem(req.tenantId,req.user,req.params.sessionId,req.params.menuItemId,input.quantity,input.seatNumber??null,V2_OPTIONS)})}catch(error){next(error)}});
router.patch('/v2/sesiones/:sessionId/items/:itemId',requirePermission('PEDIDOS.CREAR'),async(req,res,next)=>{try{res.json({ok:true,data:await identity.updateOrderItemMeta(req.tenantId,req.user,req.params.sessionId,req.params.itemId,parse(metaSchema,req.body),V2_OPTIONS)})}catch(error){next(error)}});
router.patch('/v2/sesiones/:sessionId/personas',requirePermission('PEDIDOS.CREAR'),async(req,res,next)=>{try{const input=parse(peopleSchema,req.body);res.json({ok:true,data:await identity.updateTableServiceSetup(req.tenantId,req.user,req.params.sessionId,{guestCount:input.guestCount},V2_OPTIONS)})}catch(error){next(error)}});
router.post('/v2/sesiones/:sessionId/pedido/enviar',requirePermission('PEDIDOS.CREAR'),async(req,res,next)=>{
  try{
    const data=await identity.sendWaiterDraft(req.tenantId,req.user,req.params.sessionId,V2_OPTIONS);
    // Push is deliberately best-effort. The confirmed order and its real commands are
    // authoritative; a missing/invalid FCM device can never roll back or delay the kitchen flow.
    void kdsPush.notifyLatestRound(req.tenantId,req.params.sessionId).catch(()=>{});
    res.json({ok:true,data});
  }catch(error){next(error)}
});

module.exports={restaurantV2OrdersRouter:router,V2_OPTIONS,listTablesV2};
