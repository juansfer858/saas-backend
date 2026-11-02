'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { decryptFile, databaseParts, sha256File } = require('./backup-agent');

function text(v){ return String(v ?? '').trim(); }
function run(command,args,options={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options}); let stdout=''; let stderr='';
    child.stdout?.on('data',(d)=>stdout+=d); child.stderr?.on('data',(d)=>stderr+=d); child.once('error',reject);
    child.once('exit',(code)=>code===0?resolve({stdout,stderr}):reject(new Error(`${path.basename(command)} exit=${code}: ${stderr||stdout}`)));
  });
}
function parseArgs(argv){ const out={}; for(let i=2;i<argv.length;i+=1){ const key=argv[i]; if(key.startsWith('--')) out[key.slice(2)]=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true; } return out; }
async function copyIfExists(source,destination){ try{ await fsp.access(source); await fsp.mkdir(path.dirname(destination),{recursive:true}); await fsp.cp(source,destination,{recursive:true,force:true}); return true; }catch{return false;} }

async function restore(options={},env=process.env){
  const archive=text(options.archive||env.P15_RESTORE_ARCHIVE); if(!archive) throw new Error('--archive es obligatorio.');
  const secret=text(options.secret||env.P15_BACKUP_SECRET); if(secret.length<24) throw new Error('Recovery key inválida.');
  const installDir=text(options.installDir||env.P15_INSTALL_DIR||String.raw`C:\ProgramData\VantixGC\Restaurant-P15-Lab`);
  const pgBin=text(options.pgBin||env.P15_PG_BIN||path.join(installDir,'postgres','bin'));
  const db=databaseParts(text(env.DATABASE_URL));
  const work=await fsp.mkdtemp(path.join(os.tmpdir(),'vantix-p15-restore-')); const zip=path.join(work,'bundle.zip'); const stage=path.join(work,'stage'); await fsp.mkdir(stage,{recursive:true});
  try{
    await decryptFile(archive,zip,secret);
    if(process.platform==='win32'){
      const command=`Expand-Archive -LiteralPath '${zip.replace(/'/g,"''")}' -DestinationPath '${stage.replace(/'/g,"''")}' -Force`;
      await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command]);
    }else{ await run('unzip',['-q',zip,'-d',stage]); }
    const manifest=JSON.parse(await fsp.readFile(path.join(stage,'manifest.json'),'utf8'));
    if(manifest.format!=='VANTIX_RESTAURANT_P15_BACKUP_V1') throw new Error('Manifiesto P15 incompatible.');
    if(text(manifest.tenantSubdomain)!==text(env.P15_TENANT_SUBDOMAIN)) throw new Error('El backup pertenece a otro tenant.');
    const dump=path.join(stage,'database.dump'); const dumpHash=await sha256File(dump);
    if(dumpHash!==manifest.files?.databaseDump?.sha256) throw new Error('Checksum database.dump inválido.');
    const exe=(name)=>path.join(pgBin,process.platform==='win32'?`${name}.exe`:name); const pgEnv={...process.env,PGPASSWORD:db.password};
    await run(exe('dropdb'),['-h',db.host,'-p',db.port,'-U',db.user,'--if-exists',db.database],{env:pgEnv});
    await run(exe('createdb'),['-h',db.host,'-p',db.port,'-U',db.user,db.database],{env:pgEnv});
    await run(exe('pg_restore'),['-h',db.host,'-p',db.port,'-U',db.user,'-d',db.database,'--no-owner','--no-privileges',dump],{env:pgEnv});
    await copyIfExists(path.join(stage,'config','runtime.json'),path.join(installDir,'config','runtime.json'));
    await copyIfExists(path.join(stage,'config','printers.json'),path.join(installDir,'config','printers.json'));
    await copyIfExists(path.join(stage,'files'),path.join(installDir,'files'));
    const result={ok:true,archive,tenant:manifest.tenantSubdomain,createdAt:manifest.createdAt,database:db.database,dumpSha256:dumpHash};
    console.log(`P15_RESTORE_READY ${JSON.stringify(result)}`); return result;
  }finally{ await fsp.rm(work,{recursive:true,force:true}); }
}

if(require.main===module){ const args=parseArgs(process.argv); restore(args,process.env).catch((error)=>{console.error(`P15_RESTORE_FAILED: ${error?.stack||error}`);process.exitCode=1;}); }
module.exports={restore,parseArgs};
