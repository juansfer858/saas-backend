'use strict';
const express=require('express');
const path=require('node:path');
const router=express.Router();
const webRoot=path.join(__dirname,'../../web');
const HEADER='p3-orders-independent';
function send(res,file,type){res.set('Cache-Control','no-store, max-age=0');res.set('X-VantixGC-Restaurant-V2-Orders',HEADER);if(type)res.type(type);return res.sendFile(path.join(webRoot,file));}
router.get('/app/restaurante-v2/pedidos',(_req,res)=>send(res,'restaurant-v2-orders.html','html'));
router.get('/app/restaurant-v2-orders.css',(_req,res)=>send(res,'restaurant-v2-orders.css','text/css; charset=utf-8'));
router.get('/app/restaurant-v2-orders.js',(_req,res)=>send(res,'restaurant-v2-orders.js','application/javascript; charset=utf-8'));
module.exports={restaurantV2OrdersPublicRouter:router,HEADER};
