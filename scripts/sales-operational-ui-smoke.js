const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('src/web/sales.html','utf8');
const app = fs.readFileSync('src/app.js','utf8');
for (const token of ['+ Nueva venta','Guardar borrador','Emitir venta','Documento Equivalente POS','Factura Electrónica','DIAN','Kardex/recetas','/api/v1/comercial/ventas']) {
  assert.ok(html.includes(token), `Ventas UI debe contener ${token}`);
}
assert.ok(app.includes("app.get('/app/ventas'"));
assert.ok(app.includes("salesHtmlPath"));
const vm = require('node:vm');
async function paidCancellationUi() {
  const nodes = new Map();
  const calls = [];
  const context = vm.createContext({
    Intl, URLSearchParams, Date, setTimeout,
    location:{search:''},
    localStorage:{getItem:()=>JSON.stringify({token:'qa',subdomain:'qa',tenant:{moneda:'COP'}})},
    document:{querySelector(selector){
      if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',value:''});
      return nodes.get(selector);
    },querySelectorAll:()=>[]},
    fetch:async (url,opts)=>{calls.push({url,opts});return {ok:true,status:200,json:async()=>({ok:true})}},
    prompt:()=>null
  });
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(inline.slice(0,inline.lastIndexOf('(async()=>')),context);
  context.fixtures = [
    {id:'issued',estado:'EMITIDO'}, {id:'partial',estado:'PAGADO_PARCIAL'},
    {id:'paid',estado:'PAGADO_TOTAL'}, {id:'draft',estado:'BORRADOR'},
    {id:'void',estado:'ANULADO'},
    {id:'fiscal',estado:'PAGADO_TOTAL',dianDocument:{state:'ACEPTADO'}},
    {id:'accepted-at',estado:'EMITIDO',dianDocument:{acceptedAt:'2026-09-18'}}
  ];
  vm.runInContext('st.sales=fixtures;renderList();loadList=async()=>{};',context);
  const buttons = [...nodes.get('#view').innerHTML.matchAll(/data-cancel="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(buttons,['issued','partial','paid']);
  for(const answer of [null,'   ','a','x'.repeat(501)]) {
    context.prompt=()=>answer;
    await context.cancelSale('paid');
  }
  assert.equal(calls.length,0,'no debe anular sin un motivo válido');
  context.prompt=()=> '  Error en el cobro  ';
  await context.cancelSale('paid');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/v1/comercial/ventas/paid/anular');
  assert.equal(calls[0].opts.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].opts.body),{motivo:'Error en el cobro'});
  console.log('SALES UI V132 OK: issued/partial/paid cancellation buttons, fiscal guard and mandatory reason');
}
paidCancellationUi().catch(error=>{console.error(error);process.exitCode=1});
