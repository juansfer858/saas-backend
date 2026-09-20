'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {encryptFile,decryptFile,MAGIC,databaseParts}=require('../lab/restaurant-p15/backup-agent');
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'p15-crypto-smoke-'));
  try{
    const plain=path.join(dir,'plain.bin'),enc=path.join(dir,'backup.vxp15'),out=path.join(dir,'restored.bin');
    const payload=crypto.randomBytes(256*1024+37);await fs.writeFile(plain,payload);
    const secret='P15-smoke-recovery-key-0123456789abcdef';
    await encryptFile(plain,enc,secret);const encrypted=await fs.readFile(enc);assert.equal(encrypted.subarray(0,MAGIC.length).equals(MAGIC),true);assert.notDeepEqual(encrypted.subarray(MAGIC.length,Math.min(encrypted.length,payload.length+MAGIC.length)),payload.subarray(0,Math.min(payload.length,encrypted.length-MAGIC.length)));
    await decryptFile(enc,out,secret);assert.deepEqual(await fs.readFile(out),payload);
    await assert.rejects(()=>decryptFile(enc,path.join(dir,'bad.bin'),'wrong-wrong-wrong-wrong-wrong-key'),/authenticate|auth|Unsupported state|unable/i);
    const db=databaseParts('postgresql://vantix_p15:p%40ss@127.0.0.1:55435/vantix_restaurant_p15_lab');assert.equal(db.password,'p@ss');assert.equal(db.port,'55435');assert.equal(db.database,'vantix_restaurant_p15_lab');
    console.log('RESTAURANT_P15_BACKUP_CRYPTO_SMOKE_OK');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
})().catch((error)=>{console.error(error);process.exitCode=1});
