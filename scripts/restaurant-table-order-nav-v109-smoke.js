'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function boot(file,search,exports){
 const nodes=new Map(),calls=[],n=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',classList:{toggle(){}},addEventListener(){}});return nodes.get(id)};
 const context={permissions:['PEDIDOS.VER','PEDIDOS.CREAR'],user:{rol:'ADMIN'}};
 const table={id:'table-1',name:'Mesa 1',activeSession:{id:'visit-1'}};
 const R={requireSession:()=>({tenant:{},user:{rol:'ADMIN'}}),esc:String,money:String,can:(c,p)=>c.permissions.includes(p),
 api:async path=>{calls.push(path);if(path.endsWith('ui-context'))return context;if(path.endsWith('/v2/mesas'))return [table];if(path.endsWith('/menu'))return [];if(path.endsWith('/solicitudes-apertura'))return {requests:[]};if(path.endsWith('/pedido'))return {session:table.activeSession,order:{items:[]},service:{operationalItems:[]},sale:{total:0}};throw Error(path)}};
 const window={RestaurantV2:R,location:{search,assign(url){calls.push(url)}},addEventListener(){}};
 const sandbox={window,document:{querySelector:n,querySelectorAll:()=>[]},URLSearchParams,setTimeout,clearTimeout};
 let source=fs.readFileSync(file,'utf8').replace(/loadBase\(\);\n\}\)\(\);/,'\n})();').replace(/load\(\);\n\}\)\(\);/,'\n})();');
 source=source.replace(/\}\)\(\);\s*$/, 'window.test={'+exports+'};})();');
 vm.runInNewContext(source,sandbox);
 return {api:window.test,n,calls,context,table};
}
async function main(){
 const tables=boot('src/web/restaurant-v2-tables.js','','S,orderShortcut');
 tables.api.S.context=tables.context;
 const detail={table:tables.table,session:tables.table.activeSession};
 const html=tables.api.orderShortcut(detail);
 assert.match(html,/HACER PEDIDO/);
 assert.match(html,/tableId=table-1&sessionId=visit-1&from=mesas/);
 tables.context.permissions=['PEDIDOS.VER'];
 assert.equal(tables.api.orderShortcut(detail),'');
 assert.equal(tables.api.orderShortcut({...detail,session:null}),'');
 for(const [query,expected] of [['?tableId=table-1&sessionId=visit-1','table-1'],['?tableId=table-1&sessionId=old',null],['?tableId=missing',null],['',null]]){
  const t=boot('src/web/restaurant-v2-orders.js',query,'S,loadBase');
  await t.api.loadBase();assert.equal(t.api.S.tableId,expected);
  assert.equal(t.calls.some(p=>p.includes('/sesiones/visit-1/pedido')),Boolean(expected));
  if(query.includes('old')||query.includes('missing'))assert.match(t.n('#notice').textContent,/cambió o ya está cerrada/);
  assert.equal(t.calls.some(p=>p.includes('/abrir')||p.includes('/enviar')),false);
  if(expected){t.api.S.tableId=null;await t.api.loadBase();assert.equal(t.api.S.tableId,null,'entry selection only happens once')}
 }
 console.log('V109 table to order navigation OK');
}
main().catch(e=>{console.error(e);process.exitCode=1});
