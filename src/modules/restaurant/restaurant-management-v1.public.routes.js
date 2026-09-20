'use strict';

const express=require('express');
const path=require('node:path');

const router=express.Router();
const root=path.join(__dirname,'../../web');
function send(res,file,type){
  res.set('Cache-Control','no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-Management','v1-no-qr');
  if(type)res.type(type);
  return res.sendFile(path.join(root,file));
}
router.get('/app/restaurante-v2/gestion',(_req,res)=>send(res,'restaurant-v2-management-v1.html','html'));
router.get('/app/restaurant-v2-management-v1.css',(_req,res)=>send(res,'restaurant-v2-management-v1.css','text/css; charset=utf-8'));
router.get('/app/restaurant-v2-management-v1.js',(_req,res)=>send(res,'restaurant-v2-management-v1.js','application/javascript; charset=utf-8'));

module.exports={restaurantManagementV1PublicRouter:router};
