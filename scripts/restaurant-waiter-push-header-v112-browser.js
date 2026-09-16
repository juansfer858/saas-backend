'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    const css=fs.readFileSync('src/web/restaurant-v2-design-system.css','utf8')+fs.readFileSync('src/web/restaurant-v2-orders.css','utf8');
    const html=fs.readFileSync('src/web/restaurant-v2-waiter-p8.html','utf8').replace(/<script\b[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'').replace('</head>','<style>'+css+'</style></head>');
    // Exercise the actual widget renderer without registering a device or sending Push.
    const source=fs.readFileSync('src/web/restaurant-push-v65.js','utf8').replace("  if(document.readyState==='loading')", "  window.uiTest={buildWidget,setUi}; return; if(document.readyState==='loading')");
    for(const [width,height] of [[1280,800],[1024,768],[800,1280],[390,844]]){
      await page.setViewportSize({width,height});
      await page.setContent(html);
      await page.addScriptTag({content:source});
      await page.evaluate(()=>window.uiTest.buildWidget());
      for(const [label,test] of [['🔕 Push no compatible',false],['🔔 Activar notificaciones',false],['🔔 Push activo',true]]){
        await page.evaluate(([text,test])=>window.uiTest.setUi(text,{test}),[label,test]);
        const result=await page.evaluate(()=>{
          const widget=document.getElementById('vantixPushV65'),b=widget.getBoundingClientRect(),r=document.getElementById('review').getBoundingClientRect();
          return {inHeader:!!widget.closest('.rv2-order-top'),position:getComputedStyle(widget).position,
            overlap:b.left<r.right&&b.right>r.left&&b.top<r.bottom&&b.bottom>r.top,
            inViewport:b.left>=0&&b.right<=innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};
        });
        assert.equal(result.inHeader,true);assert.equal(result.position,'static');
        assert.equal(result.overlap,false);assert.equal(result.inViewport,true);assert.equal(result.overflow,false);
      }
      console.log('V112 browser OK',width,height);
    }
  }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
