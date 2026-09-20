'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {createReceiver}=require('../lab/restaurant-p15/cloud-backup-receiver');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'p15-receiver-smoke-'));const token='P15-Receiver-Smoke-Token-123456789';const {server}=createReceiver({P15_BACKUP_RECEIVER_TOKEN:token,P15_BACKUP_STORAGE_DIR:root,P15_BACKUP_MAX_BYTES:'10485760'});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;
 try{
  const payload=crypto.randomBytes(65537);const sha=crypto.createHash('sha256').update(payload).digest('hex');
  let r=await fetch(`http://127.0.0.1:${port}/v1/backups`,{method:'PUT',headers:{authorization:`Bearer ${token}`,'x-vantix-tenant':'demo-restaurante','x-vantix-installation-id':'home-pilot-p15','x-vantix-sha256':sha,'content-type':'application/octet-stream'},body:payload});assert.equal(r.status,201);const saved=await r.json();assert.equal(saved.sha256,sha);assert.equal(saved.bytes,payload.length);
  r=await fetch(`http://127.0.0.1:${port}/v1/backups/demo-restaurante/home-pilot-p15/latest`,{headers:{authorization:`Bearer ${token}`}});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),payload);
  r=await fetch(`http://127.0.0.1:${port}/v1/backups`,{method:'PUT',headers:{authorization:'Bearer wrong','x-vantix-tenant':'demo-restaurante','x-vantix-installation-id':'home-pilot-p15','x-vantix-sha256':sha},body:payload});assert.equal(r.status,401);
  console.log('RESTAURANT_P15_BACKUP_RECEIVER_SMOKE_OK');
 }finally{await new Promise((resolve)=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
})().catch((e)=>{console.error(e);process.exitCode=1});
