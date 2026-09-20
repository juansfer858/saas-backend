'use strict';

const express=require('express');
const {z}=require('zod');
const {requirePermission}=require('../../middleware/require-permission');
const {AppError}=require('../../utils/app-error');
const service=require('./restaurant-management-v1.service');

const router=express.Router();
function parse(schema,value){const r=schema.safeParse(value);if(!r.success)throw new AppError(400,'Datos de Gestión inválidos','RESTAURANT_MANAGEMENT_VALIDATION_ERROR',r.error.flatten());return r.data}
const uuid=z.string().uuid();
const customerSchema=z.object({id:uuid.optional(),version:z.coerce.number().int().min(1).optional(),name:z.string().trim().min(1).max(160),documentType:z.enum(['','CC','NIT','CE','Pasaporte','Otro']).optional().default(''),document:z.string().trim().max(80).optional().default(''),phone:z.string().trim().max(80).optional().default(''),email:z.string().trim().max(160).optional().default(''),address:z.string().trim().max(200).optional().default('')});
const supplierSchema=z.object({id:uuid.optional(),name:z.string().trim().min(1).max(160),nit:z.string().trim().max(60).optional().default(''),contact:z.string().trim().max(200).optional().default(''),phone:z.string().trim().max(80).optional().default(''),email:z.string().trim().max(160).optional().default(''),address:z.string().trim().max(200).optional().default(''),termsDays:z.coerce.number().int().min(0).max(3650).optional().default(0),active:z.boolean().optional().default(true)});
const payablePaySchema=z.object({amount:z.coerce.number().positive().max(1000000000),method:z.enum(['EFECTIVO','TRANSFERENCIA','TARJETA']),cajaBancoId:uuid,note:z.string().trim().max(300).optional().default('')});
const periodSchema=z.object({from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)});

router.get('/gestion-v1/ventas',requirePermission('RESTAURANTE.VER'),async(req,res,next)=>{try{const p=parse(periodSchema,{from:req.query.from,to:req.query.to});res.json({ok:true,data:await service.sales(req.tenantId,p.from,p.to)})}catch(e){next(e)}});
router.get('/gestion-v1/clientes',requirePermission('RESTAURANTE.VER'),async(req,res,next)=>{try{res.json({ok:true,data:await service.customerList(req.tenantId,req.query.q||'')})}catch(e){next(e)}});
router.post('/gestion-v1/clientes',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await service.customerSave(req.tenantId,req.userId,parse(customerSchema,req.body||{}))})}catch(e){next(e)}});
router.get('/gestion-v1/proveedores',requirePermission('RESTAURANTE.VER'),async(req,res,next)=>{try{res.json({ok:true,data:await service.supplierCenter(req.tenantId)})}catch(e){next(e)}});
router.post('/gestion-v1/proveedores',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await service.supplierSave(req.tenantId,req.userId,parse(supplierSchema,req.body||{}))})}catch(e){next(e)}});
router.patch('/gestion-v1/proveedores/:id/estado',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{const id=parse(uuid,req.params.id);const active=parse(z.object({active:z.boolean()}),req.body||{}).active;res.json({ok:true,data:await service.supplierToggle(req.tenantId,req.userId,id,active)})}catch(e){next(e)}});
router.get('/gestion-v1/cuentas/:id',requirePermission('RESTAURANTE.VER'),async(req,res,next)=>{try{res.json({ok:true,data:await service.payableDetail(req.tenantId,parse(uuid,req.params.id))})}catch(e){next(e)}});
router.post('/gestion-v1/cuentas/:id/pagar',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await service.payablePay(req.tenantId,req.userId,parse(uuid,req.params.id),parse(payablePaySchema,req.body||{}))})}catch(e){next(e)}});
router.post('/gestion-v1/cuentas/:id/anular',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await service.payableVoid(req.tenantId,req.userId,parse(uuid,req.params.id))})}catch(e){next(e)}});
router.get('/gestion-v1/contexto-pagos',requirePermission('RESTAURANTE.VER'),async(req,res,next)=>{try{res.json({ok:true,data:await service.paymentContext(req.tenantId,req.userId)})}catch(e){next(e)}});

module.exports={restaurantManagementV1Router:router,customerSchema,supplierSchema,payablePaySchema,periodSchema};
