'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {prisma}=require('../src/config/prisma');
const theme=require('../src/modules/restaurant/restaurant-theme.service');
const identity=require('../src/modules/restaurant/restaurant-identity.service');
const {ensureRestaurantDemoTenant,SUBDOMAIN}=require('./ensure-restaurant-demo-tenant');
const source=(relative)=>fs.readFileSync(path.join(__dirname,'..',relative),'utf8');

async function main(){
  const editor=source('src/web/restaurant-promo-image-editor-v28.js');
  const popup=source('src/web/restaurant-v2-client-promo-v28.js');
  const menuRoutes=source('src/modules/restaurant/restaurant-v2-menu.public.routes.js');
  const qrRoutes=source('src/modules/restaurant/restaurant-v2-client-qr.public.routes.js');
  const importRoutes=source('src/modules/restaurant/restaurant-menu-import.routes.js');
  const themeSource=source('src/modules/restaurant/restaurant-theme.service.js');
  assert.match(editor,/VANTIX_RESTAURANT_PROMO_IMAGE_EDITOR_V28/);assert.match(editor,/type=\"file\"/);assert.match(editor,/imageDataUrl/);assert.match(editor,/carta-importacion\/promo-v28/);assert.match(editor,/toDataURL\('image\/jpeg'/);
  assert.match(popup,/VANTIX_RESTAURANT_CLIENT_PROMO_POPUP_V28/);assert.match(popup,/AGREGAR AL PEDIDO/);assert.match(popup,/CERRAR Y VER LA CARTA/);assert.match(popup,/data-plus/);assert.match(popup,/imageDataUrl/);
  assert.match(menuRoutes,/restaurant-promo-image-editor-v28\.js\?v=v28/);assert.match(qrRoutes,/restaurant-v2-client-promo-v28\.js\?v=v28/);assert.match(importRoutes,/promo-v28/);assert.match(themeSource,/MAX_SPOTLIGHT_IMAGE_DATA_URL/);

  await ensureRestaurantDemoTenant();
  const tenant=await prisma.tenant.findUnique({where:{subdomain:SUBDOMAIN}});assert.ok(tenant);
  const admin=await prisma.user.findFirst({where:{tenantId:tenant.id,rol:'ADMIN',activo:true}});assert.ok(admin);
  const menu=await prisma.restaurantMenuItem.findFirst({where:{tenantId:tenant.id,active:true},orderBy:{sortOrder:'asc'}});assert.ok(menu);
  const table=await prisma.restaurantTable.findFirst({where:{tenantId:tenant.id,active:true}});assert.ok(table?.qrToken);
  const imageDataUrl='data:image/png;base64,iVBORw0KGgo=';
  const saved=await theme.saveTheme(tenant.id,admin.id,{clientSpotlight:{active:true,kind:'PROMO_DIA',menuItemId:menu.id,label:'Promo con foto',description:'Agrégala al pedido',imageDataUrl}});
  assert.equal(saved.clientSpotlight.imageDataUrl,imageDataUrl);assert.equal(saved.clientSpotlight.active,true);
  const ctx=await identity.publicQrContext(table.qrToken);assert.equal(ctx.theme.clientSpotlight.imageDataUrl,imageDataUrl);assert.equal(ctx.theme.clientSpotlight.menuItemId,menu.id);
  const preserved=await theme.saveTheme(tenant.id,admin.id,{clientSpotlight:{active:true,kind:'PROMO_DIA',menuItemId:menu.id,label:'Promo editada',description:null}});assert.equal(preserved.clientSpotlight.imageDataUrl,imageDataUrl,'ediciones antiguas no deben borrar la foto');
  const disabled=await theme.saveTheme(tenant.id,admin.id,{clientSpotlight:{active:false,kind:'PROMO_DIA',menuItemId:menu.id,label:'Promo del día',description:null,imageDataUrl:null}});assert.equal(disabled.clientSpotlight.active,false);assert.equal(disabled.clientSpotlight.imageDataUrl,null);
  console.log(JSON.stringify({ok:true,promoImageV28:true,qrPopup:true,reusesNormalAdd:true,imagePersists:true}));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>prisma.$disconnect());
