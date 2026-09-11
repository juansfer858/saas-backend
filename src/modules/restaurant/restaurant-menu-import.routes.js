'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./restaurant-menu-import.service');
const linkService = require('./restaurant-menu-import-link.service');
const localOcr = require('./restaurant-menu-local-ocr.service');
const cleanup = require('./restaurant-menu-ocr-cleanup.service');
const menuItemEdit = require('./restaurant-menu-item-edit.service');
const commercialCategories = require('./restaurant-commercial-categories-v26.service');
const restaurantTheme = require('./restaurant-theme.service');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');

const router = express.Router();
const rawMenuFileParser = express.raw({ type: 'application/octet-stream', limit: service.MAX_FILE_BYTES });

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de importación de carta inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}
function parseRawMenuFile(req,res,next){ rawMenuFileParser(req,res,(error)=>{ if(error?.type==='entity.too.large'||error?.status===413) return next(new AppError(413,`La carta supera el máximo de ${Math.floor(service.MAX_FILE_BYTES/1024/1024)} MB`,'RESTAURANT_MENU_OCR_FILE_TOO_LARGE')); if(error)return next(error); return next(); }); }
function resolvedOcrStatus(){ const local=localOcr.providerStatus(service.MAX_FILE_BYTES); if(local.configured)return local; return service.providerStatus(); }
async function analyzeWithAvailableProvider(input){ const local=localOcr.providerStatus(service.MAX_FILE_BYTES); if(local.configured)return localOcr.analyzeDocument(input,service.MAX_FILE_BYTES); return service.analyzeDocument(input); }

const analyzeSchema=z.object({fileName:z.string().trim().min(1).max(120),mimeType:z.enum(['application/pdf','image/jpeg','image/png','image/webp']),dataBase64:z.string().min(16)});
const binaryAnalyzeMetaSchema=z.object({fileName:z.string().trim().min(1).max(120),mimeType:z.enum(['application/pdf','image/jpeg','image/png','image/webp'])});
const itemSchema=z.object({category:z.string().trim().min(1).max(80),subcategory:z.string().trim().min(1).max(180),price:z.coerce.number().positive().max(1000000000),operationalCategory:z.enum(['ENTRADAS','FUERTES','BEBIDAS','POSTRES']),station:z.enum(['COCINA','BARRA','POSTRES']),confidence:z.coerce.number().min(0).max(1).optional().default(1),existingProductId:z.string().uuid().optional().nullable()});
const confirmSchema=z.object({fileName:z.string().trim().max(120).optional().nullable(),items:z.array(itemSchema).min(1).max(300)});
const editImportedItemSchema=z.object({category:z.string().trim().min(1).max(80),subcategory:z.string().trim().min(1).max(180),price:z.coerce.number().positive().max(1000000000),operationalCategory:z.enum(['ENTRADAS','FUERTES','BEBIDAS','POSTRES']),station:z.enum(['COCINA','BARRA','POSTRES'])});
const editCartaItemSchema=z.object({name:z.string().trim().min(2).max(180),price:z.coerce.number().min(0).max(1000000000),categoryId:z.string().uuid(),category:z.string().trim().min(1).max(80),operationalCategory:z.enum(['ENTRADAS','FUERTES','BEBIDAS','POSTRES']),station:z.enum(['COCINA','BARRA','POSTRES']),mode:z.enum(['PREPARED','DIRECT','RECIPE']),active:z.boolean()});
const commercialCategoryCreateSchema=z.object({name:z.string().trim().min(1).max(80),sortOrder:z.coerce.number().int().min(0).max(10000).optional()});
const commercialCategoryUpdateSchema=z.object({name:z.string().trim().min(1).max(80).optional(),sortOrder:z.coerce.number().int().min(0).max(10000).optional(),active:z.boolean().optional()}).refine((input)=>Object.keys(input).length>0,{message:'Debe enviar al menos un cambio'});
const commercialCategoryAssignSchema=z.object({categoryId:z.string().uuid()});
const promoV28Schema=z.object({
  active:z.boolean(),
  menuItemId:z.string().uuid().optional().nullable(),
  label:z.string().trim().max(60).optional().nullable(),
  description:z.string().trim().max(180).optional().nullable(),
  imageDataUrl:z.union([z.string().max(restaurantTheme.MAX_SPOTLIGHT_IMAGE_DATA_URL).regex(restaurantTheme.IMAGE_DATA_URL_RE),z.null()]).optional()
});

router.get('/carta-importacion/status',requirePermission('RESTAURANTE.ADMINISTRAR'),async(_req,res,next)=>{try{const status=resolvedOcrStatus();res.json({ok:true,data:{...status,acceptedMimeTypes:[...service.ALLOWED_MIME_TYPES],note:status.configured?(status.provider==='LOCAL_OCR'?'OCR local listo para analizar foto o PDF sin API key':'OCR listo para analizar foto o PDF'):'OCR no disponible en este servidor'}});}catch(error){next(error);}});
router.get('/carta-importacion/categorias',requirePermission('PEDIDOS.VER'),async(req,res,next)=>{try{res.set('X-VantixGC-Restaurant-Commercial-Categories','v26');res.json({ok:true,data:await commercialCategories.listCategories(req.tenantId,{includeInactive:req.query.includeInactive==='true'})});}catch(error){next(error);}});
router.post('/carta-importacion/categorias',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.status(201).json({ok:true,data:await commercialCategories.createCategory(req.tenantId,parse(commercialCategoryCreateSchema,req.body||{}))});}catch(error){next(error);}});
router.patch('/carta-importacion/categorias/:id',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await commercialCategories.updateCategory(req.tenantId,req.params.id,parse(commercialCategoryUpdateSchema,req.body||{}))});}catch(error){next(error);}});
router.get('/carta-importacion/lista',requirePermission('PEDIDOS.VER'),async(req,res,next)=>{try{const rows=(await service.listCarta(req.tenantId)).map((row)=>({...row,menuItemId:row.menuItemId||row.id}));res.json({ok:true,data:await commercialCategories.decorateCartaRows(req.tenantId,rows)});}catch(error){next(error);}});
router.put('/carta-importacion/items/:id/categoria',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await commercialCategories.assignMenuItem(req.tenantId,req.params.id,parse(commercialCategoryAssignSchema,req.body||{}).categoryId)});}catch(error){next(error);}});
router.patch('/carta-importacion/items/:id/editar-v27',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.set('X-VantixGC-Restaurant-Carta-Edit','v27');res.json({ok:true,data:await menuItemEdit.updateCartaItem(req.tenantId,req.userId,req.params.id,parse(editCartaItemSchema,req.body||{}))});}catch(error){next(error);}});
router.patch('/carta-importacion/items/:id',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{const input=parse(editImportedItemSchema,req.body||{});const updated=await menuItemEdit.updateImportedCartaItem(req.tenantId,req.userId,req.params.id,input);const assignment=await commercialCategories.assignMenuItemByName(req.tenantId,updated.id,input.category);res.json({ok:true,data:{...updated,menuItemId:updated.id,categoryId:assignment.category.id,category:assignment.category.name}});}catch(error){next(error);}});

router.patch('/carta-importacion/promo-v28',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{const input=parse(promoV28Schema,req.body||{});const data=await restaurantTheme.saveTheme(req.tenantId,req.userId,{clientSpotlight:{...input,kind:'PROMO_DIA'}});res.set('X-VantixGC-Restaurant-Promo','image-popup-v28');res.json({ok:true,data:data.clientSpotlight});}catch(error){next(error);}});

router.post('/carta-importacion/analizar',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await analyzeWithAvailableProvider(parse(analyzeSchema,req.body||{}))});}catch(error){next(error);}});
router.post('/carta-importacion/analizar-binario',requirePermission('RESTAURANTE.ADMINISTRAR'),parseRawMenuFile,async(req,res,next)=>{try{const meta=parse(binaryAnalyzeMetaSchema,req.query||{});const buffer=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0);if(!buffer.length)throw new AppError(400,'El archivo está vacío','RESTAURANT_MENU_OCR_FILE_EMPTY');res.json({ok:true,data:await analyzeWithAvailableProvider({...meta,dataBase64:buffer.toString('base64')})});}catch(error){next(error);}});
router.post('/carta-importacion/confirmar',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{const input=parse(confirmSchema,req.body||{});const result=await linkService.confirmImportLinked(req.tenantId,req.userId,input);for(const item of Array.isArray(result?.items)?result.items:[]){if(item?.menuItemId&&item?.category)await commercialCategories.assignMenuItemByName(req.tenantId,item.menuItemId,item.category);}res.status(201).json({ok:true,data:result});}catch(error){next(error);}});
router.delete('/carta-importacion/importados-ocr',requirePermission('RESTAURANTE.ADMINISTRAR'),async(req,res,next)=>{try{res.json({ok:true,data:await cleanup.clearImportedOcr(req.tenantId)});}catch(error){next(error);}});

module.exports={restaurantMenuImportRouter:router,resolvedOcrStatus,analyzeWithAvailableProvider,parseRawMenuFile};
