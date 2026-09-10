/* VANTIX_RESTAURANT_V2_DEVICE_PWA_P8 · VANTIX_RESTAURANT_V2_ONLY_P12 */
(()=>{'use strict';
  const device=String(document.body?.dataset?.vantixDevice||'').toLowerCase();
  const config=device==='production'
    ?{name:'Producción V2',sw:'/app/produccion-v2/sw.js',scope:'/app/produccion-v2/',legacyScope:'/app/produccion'}
    :{name:'Mesero V2',sw:'/app/centro-de-control/mesero-v2/sw.js',scope:'/app/centro-de-control/mesero-v2/',legacyScope:'/app/centro-de-control'};
  const LEGACY_CACHE_PREFIXES=['vantixgc-waiter-shell-','vantixgc-production-','vantixgc-restaurant-production-','vantixgc-restaurant-v1-'];
  let deferredInstallPrompt=null;
  function standalone(){return window.matchMedia?.('(display-mode: standalone)')?.matches||window.navigator.standalone===true}
  function installButton(){return document.getElementById('rv2InstallDevice')}
  function ensureInstallButton(){const button=installButton();if(!button)return;if(standalone()){button.hidden=true;return}button.hidden=false}
  async function install(){const button=installButton();if(!button)return;if(deferredInstallPrompt){button.disabled=true;try{deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice}catch{}finally{deferredInstallPrompt=null;button.disabled=false;ensureInstallButton()}return}const ua=navigator.userAgent||'';if(/iPad|iPhone|iPod/i.test(ua))alert(`Para instalar ${config.name} en iPhone/iPad: toca Compartir y luego “Añadir a pantalla de inicio”.`);else alert(`Para instalar ${config.name}: abre el menú del navegador y elige “Instalar aplicación” o “Añadir a pantalla principal”.`)}
  async function retireLegacyRuntime(){
    try{
      const registrations=await navigator.serviceWorker.getRegistrations();
      const legacyScope=new URL(config.legacyScope,location.origin).href.replace(/\/$/,'');
      await Promise.all(registrations.map(async registration=>{
        const scope=String(registration.scope||'').replace(/\/$/,'');
        if(scope===legacyScope&&scope!==new URL(config.scope,location.origin).href.replace(/\/$/,'')){
          try{await registration.unregister()}catch{}
        }
      }));
    }catch{}
    try{
      if('caches'in window){
        const keys=await caches.keys();
        await Promise.all(keys.filter(key=>LEGACY_CACHE_PREFIXES.some(prefix=>key.startsWith(prefix))).map(key=>caches.delete(key)));
      }
    }catch{}
  }
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;ensureInstallButton()});
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;const button=installButton();if(button)button.hidden=true});
  installButton()?.addEventListener('click',install);
  if('serviceWorker'in navigator&&window.isSecureContext){
    retireLegacyRuntime().finally(()=>{
      navigator.serviceWorker.register(config.sw,{scope:config.scope}).then(registration=>{window.VantixGCRestaurantDevicePwaP8=Object.freeze({marker:'VANTIX_RESTAURANT_V2_DEVICE_PWA_P8',version:'12.0.0',device,name:config.name,scope:registration.scope,apiCache:false,pairingTokenCache:false,v1Runtime:false,v2Only:true,legacyWorkerRetired:true})}).catch(error=>console.warn('VANTIX_RESTAURANT_V2_DEVICE_PWA_P8_SW',error));
    });
  }
  ensureInstallButton();
})();
