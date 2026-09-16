'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/web/restaurant-push-v65.js','utf8');
function fixture(waiter){
  const ids=new Map();
  function element(){return {style:{},children:[],listeners:{},appendChild(child){this.children.push(child);child.parent=this;ids.set(child.id,child)},
    addEventListener(name,fn){this.listeners[name]=fn},querySelectorAll(){return this.children},
    set innerHTML(value){for(const id of ['vantixPushV65Main','vantixPushV65Test']){const btn=element();btn.id=id;btn.hidden=id.endsWith('Test');this.appendChild(btn)}}};}
  const body=element(),actions=element();
  const document={readyState:'loading',body,addEventListener(){},getElementById:id=>ids.get(id),createElement:element,
    querySelector:selector=>waiter&&selector==='body[data-vantix-device="waiter"] .rv2-order-top .top-actions'?actions:null};
  const window={};
  vm.runInNewContext(source.replace("  if(document.readyState===", "  window.testUi={buildWidget,setUi};\n  if(document.readyState==="),{window,document});
  window.testUi.buildWidget();
  const root=ids.get('vantixPushV65');
  assert.equal(root.parent,waiter?actions:body);
  assert.equal(root.style.position,waiter?'static':'fixed');
  assert.equal(root.style.bottom,waiter?'auto':'14px');
  assert.equal(typeof ids.get('vantixPushV65Main').listeners.click,'function');
  assert.equal(typeof ids.get('vantixPushV65Test').listeners.click,'function');
  for(const text of ['🔕 Push no compatible','🔔 Activar notificaciones','🔔 Push activo','🔔 Reintentar Push']){
    window.testUi.setUi(text,{test:true});
    assert.equal(ids.get('vantixPushV65Main').textContent,text);
    assert.equal(ids.get('vantixPushV65Test').hidden,false);
    assert.equal(root.parent,waiter?actions:body);
  }
  window.testUi.buildWidget();
  assert.equal((waiter?actions:body).children.length,1,'no duplica el control');
  if(waiter){assert.equal(actions.style.flexWrap,'wrap');assert.equal(root.style.zIndex,'auto')}
}
fixture(true);fixture(false);
console.log('V112 OK: waiter header, no fixed overlay, original actions/state and other screens retained');
