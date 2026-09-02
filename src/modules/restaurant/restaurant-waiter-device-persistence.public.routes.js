'use strict';

const express = require('express');

const router = express.Router();
const BACKUP_KEY = 'vantixgc_waiter_device_session_v26';
const SESSION_KEY = 'vantixgc_core_session_v1';

function interceptSend(res, transform) {
  const original = res.send.bind(res);
  res.send = (body) => {
    if (typeof body === 'string') body = transform(body);
    return original(body);
  };
}

function bootstrapSource() {
  return `(() => {\n  'use strict';\n  const SESSION_KEY='${SESSION_KEY}';\n  const BACKUP_KEY='${BACKUP_KEY}';\n  function read(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}\n  function isWaiterDevice(s){return Boolean(s?.token&&s?.subdomain&&s?.persistent===true&&s?.user?.rol==='MESERO');}\n  const current=read(SESSION_KEY);\n  const backup=read(BACKUP_KEY);\n  if(isWaiterDevice(current)){localStorage.setItem(BACKUP_KEY,JSON.stringify(current));document.documentElement.dataset.waiterPersistent='1';}\n  else if(!current&&isWaiterDevice(backup)){localStorage.setItem(SESSION_KEY,JSON.stringify(backup));document.documentElement.dataset.waiterPersistent='1';}\n  window.VantixGCWaiterDevicePersistenceV26=Object.freeze({version:'26.0.0',sessionKey:SESSION_KEY,backupKey:BACKUP_KEY,persistentUntilAdminRevokes:true});\n})();\n`;
}

function patchRuntime(source) {
  if (source.includes('VANTIX_WAITER_DEVICE_PERSISTENCE_V26')) return source;
  const oldBlock = `if (response.status === 401) {\n      localStorage.removeItem(SESSION_KEY);\n      throw Object.assign(new Error('Este dispositivo perdió la vinculación. Genera un QR nuevo desde Empleados.'), { fatal:true });\n    }`;
  const replacement = `if (response.status === 401) {\n      const authCode = String(body?.error?.code || body?.code || '');\n      const revoked = authCode === 'RESTAURANT_WAITER_DEVICE_REVOKED';\n      if (revoked) {\n        localStorage.removeItem(SESSION_KEY);\n        localStorage.removeItem('${BACKUP_KEY}');\n        throw Object.assign(new Error('Este dispositivo fue desautorizado por Administración. Vincúlalo nuevamente desde Empleados.'), { fatal:true, revoked:true });\n      }\n      throw Object.assign(new Error(body?.error?.message || body?.message || 'El acceso del Mesero está temporalmente inactivo. El vínculo de esta tablet se conserva y volverá automáticamente cuando Administración reactive al empleado.'), { fatal:true, temporary:true });\n    }`;
  let patched = source.replace(oldBlock, replacement);
  if (patched === source) return source;
  patched += `\n// VANTIX_WAITER_DEVICE_PERSISTENCE_V26\n`;
  return patched;
}

router.use('/app/restaurant-waiter-runtime-v7.js', (_req, res, next) => {
  interceptSend(res, (source) => `${bootstrapSource()}${patchRuntime(source)}`);
  res.set('X-VantixGC-Waiter-Device-Persistence', 'v26-until-admin-revokes');
  next();
});

module.exports = {
  restaurantWaiterDevicePersistencePublicRouter:router,
  SESSION_KEY,
  BACKUP_KEY,
  bootstrapSource,
  patchRuntime
};
