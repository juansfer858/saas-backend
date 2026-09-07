'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { verifyAccessToken } = require('../../utils/jwt');
const rbac = require('../platform/rbac/rbac.service');
const waiterDevices = require('./restaurant-waiter-device.service');
const restaurant = require('./restaurant.service');

const router = express.Router();
const MARKER = 'VANTIX_RESTAURANT_TABLE_ENABLE_V55';
const STAFF_MARKER = 'VANTIX_RESTAURANT_TABLE_ENABLE_STAFF_V55';
const ORIGIN_TYPE = 'RESTAURANT_TABLE_ENABLE_REQUEST';
const REQUEST_TTL_MS = 10 * 60 * 1000;

function timelineArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

function latestRequestMeta(row) {
  return [...timelineArray(row?.timeline)].reverse().find((event) => event?.type === 'TABLE_ENABLE_REQUESTED') || null;
}

function bearerToken(req) {
  const header = String(req.get('authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function activeTableByQr(qrToken, client = prisma) {
  const table = await client.restaurantTable.findUnique({
    where: { qrToken:String(qrToken || '') },
    select: { id:true, tenantId:true, code:true, name:true, active:true, state:true, assignedWaiterId:true }
  });
  if (!table || !table.active) throw new AppError(404, 'QR de mesa no encontrado', 'RESTAURANT_QR_NOT_FOUND');
  return table;
}

async function currentSession(table, client = prisma) {
  return client.restaurantTableSession.findFirst({
    where: { tenantId:table.tenantId, tableId:table.id, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
    orderBy: { openedAt:'desc' }
  });
}

async function closeRequest(row, status, eventType, details = {}) {
  if (!row?.id) return;
  const now = new Date();
  const timeline = [...timelineArray(row.timeline), { type:eventType, at:now.toISOString(), ...details }];
  await prisma.trackingLink.updateMany({
    where: { id:row.id, active:true },
    data: { active:false, currentStatus:status, completedAt:now, timeline }
  }).catch(() => {});
}

async function requestTableEnable(qrToken) {
  const table = await activeTableByQr(qrToken);
  const live = await currentSession(table);
  if (live) {
    return {
      state:'ENABLED',
      enabled:true,
      requestId:null,
      table:{ id:table.id, code:table.code, name:table.name },
      sessionId:live.id
    };
  }

  const now = new Date();
  const existing = await prisma.trackingLink.findUnique({
    where: { tenantId_originType_originId:{ tenantId:table.tenantId, originType:ORIGIN_TYPE, originId:table.id } }
  });
  if (existing?.active && existing.currentStatus === 'PENDING' && new Date(existing.expiresAt) > now) {
    return {
      state:'PENDING',
      enabled:false,
      requestId:existing.id,
      table:{ id:table.id, code:table.code, name:table.name },
      requestedAt:latestRequestMeta(existing)?.at || existing.creadoEn,
      expiresAt:existing.expiresAt
    };
  }

  const raw = crypto.randomBytes(32).toString('base64url');
  const event = {
    type:'TABLE_ENABLE_REQUESTED',
    at:now.toISOString(),
    tableId:table.id,
    tableCode:table.code,
    tableName:table.name,
    assignedWaiterId:table.assignedWaiterId || null
  };
  const row = await prisma.trackingLink.upsert({
    where: { tenantId_originType_originId:{ tenantId:table.tenantId, originType:ORIGIN_TYPE, originId:table.id } },
    create: {
      tenantId:table.tenantId,
      tokenHash:crypto.createHash('sha256').update(raw).digest('hex'),
      tokenCiphertext:`TABLE_ENABLE:${table.id}`,
      tokenHint:raw.slice(-6),
      originType:ORIGIN_TYPE,
      originId:table.id,
      publicReference:table.assignedWaiterId || 'ALL',
      currentStatus:'PENDING',
      timeline:[event],
      expiresAt:new Date(now.getTime() + REQUEST_TTL_MS),
      active:true,
      completedAt:null,
      lastNotificationAt:now,
      createdByUserId:null
    },
    update: {
      tokenHash:crypto.createHash('sha256').update(raw).digest('hex'),
      tokenCiphertext:`TABLE_ENABLE:${table.id}`,
      tokenHint:raw.slice(-6),
      publicReference:table.assignedWaiterId || 'ALL',
      currentStatus:'PENDING',
      timeline:[event],
      expiresAt:new Date(now.getTime() + REQUEST_TTL_MS),
      active:true,
      completedAt:null,
      lastNotificationAt:now
    }
  });

  return {
    state:'PENDING',
    enabled:false,
    requestId:row.id,
    table:{ id:table.id, code:table.code, name:table.name },
    requestedAt:event.at,
    expiresAt:row.expiresAt
  };
}

async function publicEnableStatus(qrToken) {
  const table = await activeTableByQr(qrToken);
  const live = await currentSession(table);
  const row = await prisma.trackingLink.findUnique({
    where: { tenantId_originType_originId:{ tenantId:table.tenantId, originType:ORIGIN_TYPE, originId:table.id } }
  });
  if (live) {
    if (row?.active) await closeRequest(row, 'ENABLED', 'TABLE_ENABLE_DETECTED', { sessionId:live.id });
    return { state:'ENABLED', enabled:true, requestId:null, table:{ id:table.id, code:table.code, name:table.name }, sessionId:live.id };
  }
  if (row?.active && row.currentStatus === 'PENDING' && new Date(row.expiresAt) > new Date()) {
    return { state:'PENDING', enabled:false, requestId:row.id, table:{ id:table.id, code:table.code, name:table.name }, requestedAt:latestRequestMeta(row)?.at || row.creadoEn, expiresAt:row.expiresAt };
  }
  return { state:'REQUIRED', enabled:false, requestId:null, table:{ id:table.id, code:table.code, name:table.name } };
}

async function staffActor(req, permission) {
  const raw = bearerToken(req);
  if (!raw) throw new AppError(401, 'Autenticación requerida para habilitar mesas', 'RESTAURANT_TABLE_ENABLE_AUTH_REQUIRED');
  let payload;
  try { payload = verifyAccessToken(raw); }
  catch { throw new AppError(401, 'Sesión no válida', 'RESTAURANT_TABLE_ENABLE_AUTH_INVALID'); }
  if (!payload?.tenantId || !payload?.userId) throw new AppError(401, 'Sesión incompleta', 'RESTAURANT_TABLE_ENABLE_AUTH_INVALID');

  const subdomain = String(req.get('x-tenant-subdomain') || '').trim().toLowerCase();
  const tenant = await prisma.tenant.findFirst({
    where: { id:payload.tenantId, activo:true, ...(subdomain ? { subdomain } : {}) },
    select: { id:true, subdomain:true }
  });
  if (!tenant) throw new AppError(403, 'La sesión no pertenece a este restaurante', 'AUTH_TENANT_MISMATCH');
  const user = await prisma.user.findFirst({
    where: { id:payload.userId, tenantId:payload.tenantId, activo:true },
    select: { id:true, nombre:true, rol:true }
  });
  if (!user) throw new AppError(401, 'Usuario no disponible', 'RESTAURANT_TABLE_ENABLE_USER_INVALID');

  if (payload.authType === 'WAITER_DEVICE') {
    if (!payload.deviceId || user.rol !== 'MESERO') throw new AppError(401, 'Dispositivo Mesero no válido', 'RESTAURANT_TABLE_ENABLE_DEVICE_INVALID');
    await waiterDevices.assertActiveDevice(payload.deviceId, payload.tenantId, payload.userId);
  }

  const allowed = await rbac.hasPermission(payload.tenantId, user, permission);
  if (!allowed) throw new AppError(403, `Permiso requerido: ${permission}`, 'AUTH_PERMISSION_FORBIDDEN', { permission });
  return { tenantId:payload.tenantId, user, payload };
}

async function staffRequestsSnapshot(tenantId, user) {
  const now = new Date();
  await prisma.trackingLink.updateMany({
    where: { tenantId, originType:ORIGIN_TYPE, active:true, expiresAt:{ lte:now } },
    data: { active:false, currentStatus:'EXPIRED', completedAt:now }
  }).catch(() => {});

  const rows = await prisma.trackingLink.findMany({
    where: { tenantId, originType:ORIGIN_TYPE, active:true, currentStatus:'PENDING', expiresAt:{ gt:now } },
    orderBy: { creadoEn:'asc' },
    take:100
  });
  if (!rows.length) return [];

  const tableIds = [...new Set(rows.map((row) => row.originId))];
  const [tables, sessions] = await Promise.all([
    prisma.restaurantTable.findMany({ where:{ tenantId, id:{ in:tableIds }, active:true }, select:{ id:true, code:true, name:true, state:true, assignedWaiterId:true } }),
    prisma.restaurantTableSession.findMany({ where:{ tenantId, tableId:{ in:tableIds }, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } }, select:{ id:true, tableId:true } })
  ]);
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const sessionByTable = new Map(sessions.map((session) => [session.tableId, session]));
  const out = [];

  for (const row of rows) {
    const table = tableById.get(row.originId);
    if (!table) {
      await closeRequest(row, 'CLOSED', 'TABLE_ENABLE_TABLE_REMOVED');
      continue;
    }
    const live = sessionByTable.get(table.id);
    if (live) {
      await closeRequest(row, 'ENABLED', 'TABLE_ENABLE_DETECTED', { sessionId:live.id });
      continue;
    }
    if (user?.rol === 'MESERO' && table.assignedWaiterId && table.assignedWaiterId !== user.id) continue;
    const meta = latestRequestMeta(row) || {};
    out.push({
      id:row.id,
      state:'PENDING',
      requestedAt:meta.at || row.creadoEn,
      expiresAt:row.expiresAt,
      priority:table.assignedWaiterId === user?.id ? 'ASSIGNED' : 'GENERAL',
      table:{ id:table.id, code:table.code, name:table.name, state:table.state }
    });
  }
  return out;
}

async function enableRequestedTable(tenantId, user, requestId) {
  const row = await prisma.trackingLink.findFirst({ where:{ id:requestId, tenantId, originType:ORIGIN_TYPE } });
  if (!row) throw new AppError(404, 'Solicitud de habilitación no encontrada', 'RESTAURANT_TABLE_ENABLE_REQUEST_NOT_FOUND');
  const table = await prisma.restaurantTable.findFirst({ where:{ id:row.originId, tenantId, active:true } });
  if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
  if (user?.rol === 'MESERO' && table.assignedWaiterId && table.assignedWaiterId !== user.id) {
    throw new AppError(403, 'Esta mesa corresponde al mesero asignado', 'RESTAURANT_TABLE_ENABLE_WAITER_FORBIDDEN');
  }

  let live = await currentSession(table);
  let opened = null;
  if (!live) {
    if (!row.active || row.currentStatus !== 'PENDING' || new Date(row.expiresAt) <= new Date()) {
      throw new AppError(409, 'Esta solicitud ya no está activa', 'RESTAURANT_TABLE_ENABLE_REQUEST_EXPIRED');
    }
    try {
      opened = await restaurant.openTable(tenantId, user, table.id, { guestCount:1, billingMode:'CONJUNTA', customerPhoneE164:null });
      live = opened.session;
    } catch (error) {
      if (error?.code !== 'RESTAURANT_TABLE_ALREADY_OPEN') throw error;
      live = await currentSession(table);
      if (!live) throw error;
    }
  }

  const now = new Date();
  const timeline = [...timelineArray(row.timeline), {
    type:'TABLE_ENABLE_APPROVED',
    at:now.toISOString(),
    tableId:table.id,
    sessionId:live.id,
    approvedByUserId:user.id,
    approvedByName:user.nombre || null
  }];
  await prisma.trackingLink.updateMany({
    where:{ id:row.id, active:true },
    data:{ active:false, currentStatus:'ENABLED', completedAt:now, timeline, lastNotificationAt:now }
  });

  return {
    enabled:true,
    requestId:row.id,
    table:{ id:table.id, code:table.code, name:table.name, state:'OCUPADA' },
    sessionId:live.id,
    openedBy:{ id:user.id, name:user.nombre || null },
    alreadyOpen:!opened
  };
}

router.post('/api/public/restaurante/qr/:token/habilitacion-mesa', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Table-Enable', 'v55-staff-gate');
    res.status(202).json({ ok:true, data:await requestTableEnable(req.params.token) });
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/qr/:token/habilitacion-mesa', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Table-Enable', 'v55-staff-gate');
    res.json({ ok:true, data:await publicEnableStatus(req.params.token) });
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/habilitaciones-mesa', async (req, res, next) => {
  try {
    const actor = await staffActor(req, 'MESAS.VER');
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Table-Enable', 'v55-staff-gate');
    res.json({ ok:true, data:await staffRequestsSnapshot(actor.tenantId, actor.user) });
  } catch (error) { next(error); }
});

router.post('/api/public/restaurante/habilitaciones-mesa/:id/habilitar', async (req, res, next) => {
  try {
    const actor = await staffActor(req, 'MESAS.CREAR');
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Table-Enable', 'v55-staff-gate');
    res.json({ ok:true, data:await enableRequestedTable(actor.tenantId, actor.user, req.params.id) });
  } catch (error) { next(error); }
});

const qrEnableRuntimeV55 = String.raw`
;(()=>{
  'use strict';
  const MARKER='${MARKER}';
  if(window[MARKER]) return;
  const qrToken=decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()||'');
  if(!qrToken) return;
  const prefix='/api/public/restaurante/qr/'+encodeURIComponent(qrToken);
  const previousFetch=window.fetch.bind(window);
  let gatePromise=null;
  let cancelled=false;

  function target(input){return typeof input==='string'?input:(input&&typeof input.url==='string'?input.url:'');}
  function method(input,init){return String(init?.method||(typeof Request!=='undefined'&&input instanceof Request?input.method:'GET')).toUpperCase();}
  function isOrder(input,init){return method(input,init)==='POST'&&target(input).includes(prefix+'/pedidos');}
  const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

  async function jsonApi(path,options={}){
    const response=await previousFetch(path,{...options,cache:'no-store'});
    const body=await response.clone().json().catch(()=>({}));
    if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
    return body?.data||{};
  }

  async function visit(){return jsonApi(prefix+'/visita');}
  async function requestEnable(){return jsonApi(prefix+'/habilitacion-mesa',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}

  function ensureStyles(){
    if(document.getElementById('restaurantTableEnableV55Styles')) return;
    const style=document.createElement('style');
    style.id='restaurantTableEnableV55Styles';
    style.textContent='.rtv55-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(18,20,19,.72);backdrop-filter:blur(7px)}.rtv55-card{width:min(560px,100%);padding:28px 22px;border-radius:24px;background:#fff;color:#172019;text-align:center;box-shadow:0 28px 80px rgba(0,0,0,.35)}.rtv55-kicker{font-size:13px;font-weight:900;letter-spacing:.12em;color:#6b756f}.rtv55-title{margin:8px 0 12px;font-size:clamp(34px,8vw,54px);line-height:.98;font-weight:1000}.rtv55-copy{margin:0 auto;max-width:430px;color:#59645e;font-size:17px;line-height:1.45}.rtv55-status{margin:20px 0 0;padding:14px;border-radius:15px;background:#edf7f1;color:#17603e;font-weight:900}.rtv55-dot{display:inline-block;width:10px;height:10px;margin-right:8px;border-radius:50%;background:currentColor;animation:rtv55pulse 1s infinite alternate}.rtv55-cancel{width:100%;min-height:50px;margin-top:15px;border:1px solid #ccd5d0;border-radius:13px;background:#fff;color:#46514b;font-weight:900}.rtv55-ok .rtv55-status{background:#e9f8ef;color:#116638}@keyframes rtv55pulse{to{opacity:.25;transform:scale(.75)}}';
    document.head.appendChild(style);
  }

  function showGate(table){
    ensureStyles(); cancelled=false;
    document.getElementById('restaurantTableEnableV55Overlay')?.remove();
    const overlay=document.createElement('div');
    overlay.id='restaurantTableEnableV55Overlay'; overlay.className='rtv55-overlay';
    const label=String(table?.name||table?.code||'MESA').toUpperCase();
    overlay.innerHTML='<section class="rtv55-card" role="dialog" aria-modal="true"><div class="rtv55-kicker">TU PEDIDO ESTÁ LISTO</div><h2 class="rtv55-title">HABILITAR '+label+'</h2><p class="rtv55-copy">El mesero debe habilitar esta mesa una sola vez. En cuanto lo haga, tu pedido se enviará automáticamente a Cocina/Barra.</p><div class="rtv55-status"><span class="rtv55-dot"></span><span id="restaurantTableEnableV55Status">Avisando al mesero…</span></div><button class="rtv55-cancel" type="button">VOLVER AL PEDIDO</button></section>';
    document.body.appendChild(overlay);
    overlay.querySelector('.rtv55-cancel')?.addEventListener('click',()=>{cancelled=true;overlay.remove();});
  }

  function gateStatus(text,ok=false){
    const overlay=document.getElementById('restaurantTableEnableV55Overlay');
    if(ok) overlay?.querySelector('.rtv55-card')?.classList.add('rtv55-ok');
    const node=document.getElementById('restaurantTableEnableV55Status'); if(node) node.textContent=text;
  }

  function synthetic(code,message){return new Response(JSON.stringify({ok:false,error:{code,message}}),{status:409,headers:{'Content-Type':'application/json'}});}

  async function waitUntilOpen(){
    const started=Date.now();
    while(Date.now()-started<10*60*1000){
      if(cancelled) throw Object.assign(new Error('Tu pedido sigue guardado. Puedes enviarlo cuando estés listo.'),{code:'RESTAURANT_TABLE_ENABLE_CANCELLED'});
      const state=await visit().catch(()=>null);
      if(state?.open) return state;
      await sleep(1200);
    }
    throw Object.assign(new Error('La mesa todavía no fue habilitada. Tu pedido sigue guardado.'),{code:'RESTAURANT_TABLE_ENABLE_TIMEOUT'});
  }

  async function ensureEnabled(){
    const current=await visit().catch(()=>null);
    if(current?.open) return true;
    if(gatePromise) return gatePromise;
    gatePromise=(async()=>{
      const request=await requestEnable();
      if(request?.state==='ENABLED') return true;
      showGate(request?.table||{});
      gateStatus('Solicitud enviada · esperando habilitación…');
      await waitUntilOpen();
      gateStatus('Mesa habilitada · enviando tu pedido…',true);
      await sleep(350);
      document.getElementById('restaurantTableEnableV55Overlay')?.remove();
      return true;
    })().finally(()=>{gatePromise=null;});
    return gatePromise;
  }

  window.fetch=async(input,init={})=>{
    if(isOrder(input,init)){
      try{await ensureEnabled();}
      catch(error){document.getElementById('restaurantTableEnableV55Overlay')?.remove();return synthetic(error?.code||'RESTAURANT_TABLE_ENABLE_REQUIRED',error?.message||'La mesa debe ser habilitada antes de enviar el pedido');}
    }
    return previousFetch(input,init);
  };

  document.documentElement.dataset.tableEnableGate='v55';
  window[MARKER]=Object.freeze({version:'55.0.0',qrAlwaysVisible:true,tableSessionRequired:true,staffApprovalOnce:true,autoSendAfterApproval:true});
})();
`;

const staffEnableRuntimeV55 = String.raw`
;(()=>{
  'use strict';
  const MARKER='${STAFF_MARKER}';
  if(window[MARKER]) return;
  const SESSION_KEY='vantixgc_core_session_v1';
  const endpoint='/api/public/restaurante/habilitaciones-mesa';
  let known=new Set();
  let timer=null;
  let running=false;

  function esc(v){return String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
  function session(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
  function headers(){const s=session();return s?.token?{'Content-Type':'application/json',Authorization:'Bearer '+s.token,'x-tenant-subdomain':s.subdomain||''}:null;}
  async function api(path,options={}){const h=headers();if(!h) throw new Error('NO_SESSION');const response=await fetch(path,{...options,cache:'no-store',headers:{...h,...(options.headers||{})}});const body=await response.json().catch(()=>({}));if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));return body?.data;}

  function ensureStyles(){if(document.getElementById('restaurantTableEnableStaffV55Styles'))return;const style=document.createElement('style');style.id='restaurantTableEnableStaffV55Styles';style.textContent='.rts55{position:fixed;z-index:2147482000;right:14px;top:76px;width:min(390px,calc(100vw - 28px));display:grid;gap:10px;pointer-events:none}.rts55-card{pointer-events:auto;padding:16px;border:2px solid #d19b1d;border-radius:18px;background:#fffdf4;color:#1d241f;box-shadow:0 18px 50px rgba(0,0,0,.23);animation:rts55in .18s ease-out}.rts55-card small{display:block;font-weight:900;color:#7b6228;letter-spacing:.08em}.rts55-card h3{margin:4px 0 5px;font-size:24px}.rts55-card p{margin:0 0 12px;color:#68716c}.rts55-card button{width:100%;min-height:54px;border:0;border-radius:13px;background:#176b45;color:#fff;font-size:16px;font-weight:1000}.rts55-card button:disabled{opacity:.55}.rts55-error{pointer-events:auto;padding:10px 12px;border-radius:12px;background:#fff1f0;color:#9f1d1d;font-weight:800}@keyframes rts55in{from{opacity:0;transform:translateY(-8px)}}@media(max-width:700px){.rts55{top:auto;bottom:14px}}';document.head.appendChild(style);}
  function root(){ensureStyles();let node=document.getElementById('restaurantTableEnableStaffV55');if(!node){node=document.createElement('div');node.id='restaurantTableEnableStaffV55';node.className='rts55';document.body.appendChild(node);}return node;}
  function render(rows){const host=root();if(!Array.isArray(rows)||!rows.length){host.innerHTML='';known=new Set();return;}const ids=new Set(rows.map((row)=>row.id));known=ids;host.innerHTML=rows.map((row)=>{const name=String(row?.table?.name||row?.table?.code||'Mesa');return '<section class="rts55-card" data-request="'+esc(row.id)+'"><small>CLIENTE LISTO PARA PEDIR</small><h3>'+esc(name)+' solicita habilitación</h3><p>El pedido ya está preparado en el celular. Habilita la mesa y se enviará automáticamente.</p><button type="button" data-enable="'+esc(row.id)+'">HABILITAR '+esc(name.toUpperCase())+'</button></section>';}).join('');host.querySelectorAll('[data-enable]').forEach((button)=>button.addEventListener('click',async()=>{const id=button.dataset.enable;button.disabled=true;button.textContent='HABILITANDO…';try{const data=await api(endpoint+'/'+encodeURIComponent(id)+'/habilitar',{method:'POST',body:'{}'});host.querySelector('[data-request="'+CSS.escape(id)+'"]')?.remove();window.dispatchEvent(new CustomEvent('vantix:restaurant-table-enabled',{detail:data||{requestId:id}}));setTimeout(()=>poll(),200);}catch(error){button.disabled=false;button.textContent='REINTENTAR HABILITAR';const card=button.closest('.rts55-card');card?.insertAdjacentHTML('beforeend','<div class="rts55-error">'+esc(error.message)+'</div>');}}));}
  async function poll(){if(running||document.visibilityState==='hidden')return;running=true;try{const h=headers();if(!h){root().innerHTML='';return;}const rows=await api(endpoint);render(rows);}catch(error){if(error.message!=='NO_SESSION'){} }finally{running=false;}}
  function schedule(){clearTimeout(timer);timer=setTimeout(async()=>{await poll();schedule();},1800);timer.unref?.();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{poll();schedule();},{once:true});else{poll();schedule();}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poll();});
  window[MARKER]=Object.freeze({version:'55.0.0',action:'HABILITAR_MESA',surfaces:['CENTRO_CONTROL','MESERO']});
})();
`;

function installRestaurantTableEnableV55(req, res, next) {
  if (req.method !== 'GET' || !['/app/restaurant-qr-ui.js', '/app/restaurant-ui.js', '/app/restaurant-waiter-runtime-v7.js'].includes(req.path)) return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    const runtime = req.path === '/app/restaurant-qr-ui.js' ? qrEnableRuntimeV55 : staffEnableRuntimeV55;
    const runtimeMarker = req.path === '/app/restaurant-qr-ui.js' ? MARKER : STAFF_MARKER;
    if (source && !source.includes(runtimeMarker)) {
      const patched = `${source}\n;${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Table-Enable', 'v55-staff-gate');
    return originalSend(body);
  };
  return next();
}

module.exports = {
  MARKER,
  STAFF_MARKER,
  ORIGIN_TYPE,
  REQUEST_TTL_MS,
  requestTableEnable,
  publicEnableStatus,
  staffRequestsSnapshot,
  enableRequestedTable,
  qrEnableRuntimeV55,
  staffEnableRuntimeV55,
  restaurantTableEnableV55PublicRouter:router,
  installRestaurantTableEnableV55
};
