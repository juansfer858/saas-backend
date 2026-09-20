'use strict';

const express=require('express');
const {z}=require('zod');
const {requirePermission}=require('../../middleware/require-permission');
const {AppError}=require('../../utils/app-error');
const service=require('./restaurant-recipes-costs-v1.service');

const router=express.Router();
function parse(schema,value){const r=schema.safeParse(value);if(!r.success)throw new AppError(400,'Datos de recetas inválidos','RESTAURANT_RECIPES_VALIDATION_ERROR',r.error.flatten());return r.data}
const uuid=z.string().uuid();
const ingredientSchema=z.object({id:uuid.optional(),code:z.string().trim().min(1).max(40),name:z.string().trim().min(1).max(120),unit:z.enum(['g','ml','unidad']),unitCost:z.coerce.number().min(0).max(1000000000000),active:z.boolean().optional().default(true)});
const minimumSchema=z.object({version:z.coerce.number().int().min(1),minimum:z.coerce.number().min(0).max(1000000000)});
const movementSchema=z.object({id:uuid,version:z.coerce.number().int().min(1),kind:z.enum(['initial','entry','exit','adjustment']),quantity:z.coerce.number().min(0).max(1000000000),unitCost:z.coerce.number().min(0).max(1000000000000).optional(),reason:z.string().trim().min(1).max(400)});
const recipeSchema=z.object({items:z.array(z.object({ingredientId:uuid,quantity:z.coerce.number().positive().max(1000000000)})).min(1).max(100)});

router.get('/recetas-costos-v1',requirePermission('RESTAURANTE.VER'),async(req,res,next)=>{try{res.json({ok:true,data:await service.center(req.tenantId)})}catch(e){next(e)}});
router.post('/recetas-costos-v1/ingredientes',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await service.saveIngredient(req.tenantId,req.userId,parse(ingredientSchema,req.body||{}))})}catch(e){next(e)}});
router.patch('/recetas-costos-v1/ingredientes/:id/minimo',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{const id=parse(uuid,req.params.id),d=parse(minimumSchema,req.body||{});res.json({ok:true,data:await service.ingredientMinimum(req.tenantId,req.userId,{id,...d})})}catch(e){next(e)}});
router.post('/recetas-costos-v1/ingredientes/movimiento',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await service.ingredientMove(req.tenantId,req.userId,parse(movementSchema,req.body||{}))})}catch(e){next(e)}});
router.get('/recetas-costos-v1/ingredientes/historial',requirePermission('RESTAURANTE.VER'),async(req,res,next)=>{try{res.json({ok:true,data:await service.ingredientHistory(req.tenantId,{ingredientId:req.query.ingredient||null,from:req.query.from||null,to:req.query.to||null})})}catch(e){next(e)}});
router.put('/recetas-costos-v1/productos/:productId',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await service.saveRecipe(req.tenantId,req.userId,parse(uuid,req.params.productId),parse(recipeSchema,req.body||{}).items)})}catch(e){next(e)}});
router.delete('/recetas-costos-v1/productos/:productId',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await service.clearRecipe(req.tenantId,req.userId,parse(uuid,req.params.productId))})}catch(e){next(e)}});

module.exports={restaurantRecipesCostsV1Router:router,ingredientSchema,minimumSchema,movementSchema,recipeSchema};
