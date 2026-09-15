'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

async function ui(){
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',classList:{toggle(){}},disabled:false});return nodes.get(id)};
  const calls=[];
  let eligible=true;
  const table={id:'table',name:'Mesa 4',state:'OCUPADA',activeSession:{id:'visit',guestCount:1}};
  const session={user:{rol:'ADMIN'},tenant:{},subdomain:'test'};
  const api=async(path,opts)=>{
    calls.push({path,method:opts?.method||'GET'});
    if(path.endsWith('/detalle-v67'))return {session:{id:'visit'},canCloseEmptyFromControlCenter:eligible};
    if(path.endsWith('/cerrar-vacia-v21'))return {closed:true};
    if(path.endsWith('/ui-context'))return {user:session.user};
    if(path.endsWith('/v2/mesas'))return [table];
    if(path.endsWith('/menu'))return [];
    if(path.endsWith('/solicitudes-apertura'))return {requests:[]};
    throw new Error('Unexpected API '+path);
  };
  const context={window:{RestaurantV2:{requireSession:()=>session,api,esc:String,money:String},addEventListener(){}},
    document:{querySelector:node,querySelectorAll:()=>[]},confirm:()=>true,setTimeout,clearTimeout,URLSearchParams};
  const source=fs.readFileSync('src/web/restaurant-v2-orders.js','utf8');
  const instrumented=source.replace('loadBase();\n})();', 'window.test={S,renderServiceControls,closeAdminEmptyTable};\n})();');
  assert.notEqual(instrumented,source);
  vm.runInNewContext(instrumented,context);
  const {S,renderServiceControls,closeAdminEmptyTable}=context.window.test;
  Object.assign(S,{tables:[table],tableId:table.id,draft:{session:{id:'visit'},sale:{total:'0'},order:{items:[]},service:{operationalItems:[]}}});
  renderServiceControls();
  assert.match(node('#serviceControls').innerHTML,/CERRAR MESA VACÍA/);
  for(const role of ['MESERO','CAJERO']){session.user.rol=role;renderServiceControls();assert.doesNotMatch(node('#serviceControls').innerHTML,/CERRAR MESA VACÍA/)}
  session.user.rol='ADMIN';
  S.draft.order.items=[{id:'free-product',quantity:1,lineTotal:0}];renderServiceControls();
  assert.doesNotMatch(node('#serviceControls').innerHTML,/CERRAR MESA VACÍA/,'producto gratis sigue siendo consumo');
  S.draft.order.items=[];
  S.draft.session.id='previous-visit';renderServiceControls();assert.doesNotMatch(node('#serviceControls').innerHTML,/CERRAR MESA VACÍA/);
  S.draft.session.id='visit';
  eligible=false;await closeAdminEmptyTable();
  assert.equal(calls.some(c=>c.method==='POST'),false,'servidor detecta actividad posterior y no se cierra');
  assert.equal(table.state,'OCUPADA');
  eligible=true;await closeAdminEmptyTable();
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
  assert.ok(calls.find(c=>c.path.endsWith('/cerrar-vacia-v21')));
  assert.equal(table.state,'LIBRE');
  assert.match(node('#notice').textContent,/quedó LIBRE/);
}

async function database(){
  const {prisma}=require('../src/config/prisma');
  try{
    const {ensureRestaurantDemoTenant}=require('./ensure-restaurant-demo-tenant');
    const restaurant=require('../src/modules/restaurant/restaurant.service');
    const identity=require('../src/modules/restaurant/restaurant-identity.service');
    const live=require('../src/modules/restaurant/restaurant-table-live-detail-v67.service');
    const demo=await ensureRestaurantDemoTenant();
    const admin=await prisma.user.findUnique({where:{id:demo.users.ADMIN}});
    const waiter=await prisma.user.findUnique({where:{id:demo.users.MESERO}});
    const opts={sharedFloor:true,optionalSeat:true};
    const table=await restaurant.createTable(demo.tenantId,{code:'E107-'+Date.now(),name:'Mesa vacía mesero CI',seats:4});
    const visit=await restaurant.openTable(demo.tenantId,waiter,table.id,{guestCount:1},opts);
    assert.equal((await live.liveDetail(demo.tenantId,admin,table.id)).canCloseEmptyFromControlCenter,true);
    const result=await live.closeEmptyFromControlCenter(demo.tenantId,admin,table.id);
    assert.equal(result.closed,true);
    assert.equal((await prisma.restaurantTable.findUnique({where:{id:table.id}})).state,'LIBRE');
    assert.equal(await prisma.comprobanteComercial.findUnique({where:{id:visit.sale.id}}),null);
    const again=await restaurant.openTable(demo.tenantId,waiter,table.id,{guestCount:1},opts);
    const menu=(await restaurant.listMenu(demo.tenantId)).find(i=>i.product&&!i.warning);
    assert.ok(menu);
    await identity.setWaiterDraftItem(demo.tenantId,waiter,again.session.id,menu.id,1,null,opts);
    await assert.rejects(live.closeEmptyFromControlCenter(demo.tenantId,admin,table.id),e=>e.code==='RESTAURANT_CONTROL_CENTER_EMPTY_CLOSE_HAS_PRODUCTS');
    assert.ok(await prisma.restaurantTableSession.findUnique({where:{id:again.session.id}}));
    // Leave no active test visit for the other scripts sharing this CI database.
    await identity.setWaiterDraftItem(demo.tenantId,waiter,again.session.id,menu.id,0,null,opts);
    await live.closeEmptyFromControlCenter(demo.tenantId,admin,table.id);
  }finally{await prisma.$disconnect()}
}
ui().then(()=>process.argv.includes('--ui-only')?null:database()).then(()=>console.log('V107 admin empty table: OK')).catch(e=>{console.error(e);process.exitCode=1});
