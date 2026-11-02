'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const {dispatchDirectedJobs}=require('../src/modules/platform/printing/p15-local-spooler.service');
(async()=>{
  let seen=null;
  const server=http.createServer((req,res)=>{
    const chunks=[];
    req.on('data',(c)=>chunks.push(c));
    req.on('end',()=>{
      seen={url:req.url,method:req.method,token:req.headers['x-vantix-print-token'],body:JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')};
      const payload=Buffer.from(JSON.stringify({ok:true,results:[{ok:true,index:0,data:{copies:1}}]}));
      res.writeHead(200,{'content-type':'application/json','content-length':payload.length});res.end(payload);
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  try{
    const port=server.address().port;
    const directed={entries:[{target:{name:'Cocina',transport:'LAN',host:'192.168.1.20',port:9100},job:{title:'MESA 1',lines:['1 x HAMBURGUESA'],copies:1,cut:true}}]};
    const result=await dispatchDirectedJobs(directed,{VANTIX_P15_LOCAL_RUNTIME:'true',P15_PRINT_PORT:String(port),P15_PRINT_TOKEN:'print-token-smoke'});
    assert.equal(result.ok,true);assert.equal(seen.url,'/print/batch');assert.equal(seen.method,'POST');assert.equal(seen.token,'print-token-smoke');assert.equal(seen.body.entries.length,1);assert.equal(seen.body.entries[0].target.transport,'LAN');
    assert.equal(await dispatchDirectedJobs(directed,{VANTIX_P15_LOCAL_RUNTIME:'false'}),null);
    console.log('RESTAURANT_P15_LOCAL_PRINT_SMOKE_OK');
  }finally{await new Promise((resolve)=>server.close(resolve));}
})().catch((e)=>{console.error(e);process.exitCode=1});
