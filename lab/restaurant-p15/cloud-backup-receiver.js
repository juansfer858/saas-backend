'use strict';

const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');

function text(v){return String(v??'').trim();}
function safe(v){const s=text(v).toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(s))throw Object.assign(new Error('Identificador inválido'),{status:400});return s;}
function auth(req,token){if(!token)return false;return req.headers.authorization===`Bearer ${token}`;}
function json(res,status,payload){const body=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body)});res.end(body);}
async function latestFile(root,tenant,installation){const dir=path.join(root,tenant,installation);let names=[];try{names=await fsp.readdir(dir);}catch{return null;}const rows=[];for(const name of names.filter((n)=>n.endsWith('.vxp15'))){const full=path.join(dir,name);rows.push({name,full,stat:await fsp.stat(full)});}rows.sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);return rows[0]||null;}
function createReceiver(env=process.env){
  const host=text(env.P15_BACKUP_RECEIVER_HOST||'127.0.0.1');const port=Number(env.P15_BACKUP_RECEIVER_PORT||18915);const token=text(env.P15_BACKUP_RECEIVER_TOKEN);const root=path.resolve(text(env.P15_BACKUP_STORAGE_DIR||path.join(process.cwd(),'p15-backups')));const maxBytes=Math.max(Number(env.P15_BACKUP_MAX_BYTES||2147483648),1048576);
  if(token.length<24)throw new Error('P15_BACKUP_RECEIVER_TOKEN debe tener al menos 24 caracteres.');
  const server=http.createServer(async(req,res)=>{try{
    if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,service:'Vantix P15 Backup Receiver',storage:root});
    if(!auth(req,token))return json(res,401,{ok:false,error:'No autorizado'});
    if(req.method==='PUT'&&req.url==='/v1/backups'){
      const tenant=safe(req.headers['x-vantix-tenant']);const installation=safe(req.headers['x-vantix-installation-id']);const expected=text(req.headers['x-vantix-sha256']).toLowerCase();if(!/^[a-f0-9]{64}$/.test(expected))return json(res,400,{ok:false,error:'Checksum requerido'});
      const dir=path.join(root,tenant,installation);await fsp.mkdir(dir,{recursive:true});const temp=path.join(dir,`.upload-${process.pid}-${Date.now()}.tmp`);const output=fs.createWriteStream(temp,{flags:'wx'});const hash=crypto.createHash('sha256');let bytes=0;
      const completed=await new Promise((resolve,reject)=>{req.on('data',(chunk)=>{bytes+=chunk.length;if(bytes>maxBytes){reject(Object.assign(new Error('Backup excede límite'),{status:413}));req.destroy();return;}hash.update(chunk);});req.on('error',reject);output.on('error',reject);output.on('finish',()=>resolve(true));req.pipe(output);}).catch(async(error)=>{output.destroy();await fsp.rm(temp,{force:true});throw error;});
      if(!completed)return;
      const actual=hash.digest('hex');if(actual!==expected){await fsp.rm(temp,{force:true});return json(res,422,{ok:false,error:'Checksum no coincide',expected,actual});}
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');const name=`${stamp}-${actual.slice(0,16)}.vxp15`;const final=path.join(dir,name);await fsp.rename(temp,final);await fsp.writeFile(`${final}.json`,JSON.stringify({tenant,installation,name,sha256:actual,bytes,receivedAt:new Date().toISOString()},null,2));return json(res,201,{ok:true,tenant,installation,name,sha256:actual,bytes});
    }
    const match=/^\/v1\/backups\/([^/]+)\/([^/]+)\/latest$/.exec(req.url||'');
    if(req.method==='GET'&&match){const tenant=safe(match[1]);const installation=safe(match[2]);const row=await latestFile(root,tenant,installation);if(!row)return json(res,404,{ok:false,error:'No hay backup'});res.writeHead(200,{'content-type':'application/octet-stream','content-length':row.stat.size,'x-vantix-backup-name':row.name});fs.createReadStream(row.full).pipe(res);return;}
    return json(res,404,{ok:false,error:'Ruta no encontrada'});
  }catch(error){return json(res,error.status||500,{ok:false,error:error.message});}});
  return {server,host,port,root};
}
if(require.main===module){const {server,host,port}=createReceiver(process.env);server.listen(port,host,()=>console.log(`P15_BACKUP_RECEIVER_READY http://${host}:${port}`));}
module.exports={createReceiver,latestFile};
