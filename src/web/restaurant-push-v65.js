(() => {
  'use strict';

  const MARKER='VANTIX_RESTAURANT_PUSH_CLIENT_V65';
  if (window[MARKER]) return;
  window[MARKER]=Object.freeze({version:'65.0.0',provider:'FCM',selfTest:true});

  const CORE_SESSION='vantixgc_core_session_v1';
  const PRODUCTION_SESSION='vantixgc_restaurant_production_device_v63';
  const FIREBASE_VERSION='10.14.1';
  const DEVICE_PREFIX='vantixgc_push_v65_device_';
  let config=null;
  let session=null;
  let messaging=null;
  let registration=null;
  let deviceId=null;
  let working=false;

  function readJson(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
  function resolveSession(){
    const core=readJson(CORE_SESSION);
    if(core?.token&&core?.subdomain)return core;
    const production=readJson(PRODUCTION_SESSION);
    if(production?.token&&production?.subdomain)return production;
    return null;
  }
  function userKey(){return `${session?.subdomain||'tenant'}_${session?.user?.id||session?.userId||'user'}`}
  function headers(){return {Authorization:`Bearer ${session.token}`,'x-tenant-subdomain':session.subdomain,'Content-Type':'application/json'}}
  async function api(path,options={}){
    const response=await fetch(path,{...options,cache:'no-store',headers:{...headers(),...(options.headers||{})}});
    let body={};try{body=await response.json()}catch{}
    if(!response.ok)throw new Error(body?.error?.message||body?.message||`HTTP ${response.status}`);
    return body.data;
  }
  async function publicConfig(){
    const response=await fetch('/api/public/restaurante/push-v65/config',{cache:'no-store'});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body?.error?.message||'No fue posible consultar Push');
    return body.data;
  }
  function loadScript(src){
    return new Promise((resolve,reject)=>{
      if(document.querySelector(`script[data-vantix-push-src="${src}"]`))return resolve();
      const script=document.createElement('script');script.src=src;script.async=true;script.dataset.vantixPushSrc=src;script.onload=resolve;script.onerror=()=>reject(new Error('No fue posible cargar Firebase Messaging'));document.head.appendChild(script);
    });
  }
  async function loadFirebase(){
    if(window.firebase?.messaging)return;
    await loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-messaging-compat.js`);
  }
  function platform(){
    const ua=navigator.userAgent||'';
    if(/iPhone|iPad|iPod/i.test(ua))return'IOS_WEB';
    if(/Android/i.test(ua))return'ANDROID_WEB';
    if(/Windows/i.test(ua))return'WINDOWS_WEB';
    return'WEB';
  }
  function label(){
    const role=String(session?.user?.rol||session?.station||'').toUpperCase();
    return role?`${role} · ${platform()}`:`VantixGC · ${platform()}`;
  }
  function toast(text,error=false){
    let el=document.getElementById('vantixPushV65Toast');
    if(!el){el=document.createElement('div');el.id='vantixPushV65Toast';Object.assign(el.style,{position:'fixed',left:'50%',bottom:'84px',transform:'translateX(-50%)',zIndex:'2147483647',padding:'10px 14px',borderRadius:'12px',font:'700 12px system-ui',boxShadow:'0 10px 30px rgba(15,23,42,.22)',maxWidth:'min(92vw,480px)',textAlign:'center'});document.body.appendChild(el)}
    el.style.background=error?'#7f1d1d':'#10233f';el.style.color='#fff';el.textContent=text;el.hidden=false;clearTimeout(el._timer);el._timer=setTimeout(()=>{el.hidden=true},3200);
  }
  function buildWidget(){
    if(document.getElementById('vantixPushV65'))return;
    const root=document.createElement('div');root.id='vantixPushV65';root.innerHTML='<button type="button" id="vantixPushV65Main">🔔 Push</button><button type="button" id="vantixPushV65Test" hidden>Probar</button>';
    Object.assign(root.style,{position:'fixed',right:'14px',bottom:'14px',zIndex:'2147483000',display:'flex',gap:'7px',alignItems:'center'});
    root.querySelectorAll('button').forEach((btn)=>Object.assign(btn.style,{border:'1px solid #cbd5e1',borderRadius:'999px',background:'#fff',color:'#10233f',minHeight:'40px',padding:'8px 13px',font:'800 12px system-ui',boxShadow:'0 8px 24px rgba(15,23,42,.15)',cursor:'pointer'}));
    document.body.appendChild(root);
    document.getElementById('vantixPushV65Main').addEventListener('click',activate);
    document.getElementById('vantixPushV65Test').addEventListener('click',sendTest);
  }
  function setUi(text,{test=false,disabled=false}={}){
    const main=document.getElementById('vantixPushV65Main');const testBtn=document.getElementById('vantixPushV65Test');if(!main)return;
    main.textContent=text;main.disabled=disabled;main.style.opacity=disabled?'.65':'1';
    if(testBtn)testBtn.hidden=!test;
  }
  async function ensureMessaging(){
    await loadFirebase();
    const apps=window.firebase.apps||[];
    if(!apps.length)window.firebase.initializeApp(config.firebaseConfig);
    registration=await navigator.serviceWorker.register('/app/push-v65-sw.js',{scope:'/app/push-v65/'});
    await navigator.serviceWorker.ready.catch(()=>registration);
    messaging=window.firebase.messaging();
    messaging.onMessage((payload)=>{
      const data=payload?.data||{};
      toast(data.title||'Nueva notificación');
      if(Notification.permission==='granted'){
        try{new Notification(data.title||'VantixGC',{body:data.body||'',tag:data.deliveryId||data.eventCode||'vantixgc',data:{deepLink:data.deepLink||'/app/centro-de-control'}})}catch{}
      }
    });
    return messaging;
  }
  async function registerToken(){
    await ensureMessaging();
    const token=await messaging.getToken({vapidKey:config.vapidKey,serviceWorkerRegistration:registration});
    if(!token)throw new Error('Firebase no entregó un token para este dispositivo');
    const device=await api('/api/v1/notificaciones/push-v65/dispositivos',{method:'POST',body:JSON.stringify({token,platform:platform(),deviceLabel:label(),permission:Notification.permission,userAgent:navigator.userAgent||''})});
    deviceId=device.id;localStorage.setItem(DEVICE_PREFIX+userKey(),deviceId);
    setUi('🔔 Push activo',{test:true});
    return device;
  }
  async function activate(){
    if(working)return;
    if(!config?.enabled)return toast('Firebase Push todavía no está configurado en el servidor.',true);
    if(!('Notification'in window)||!('serviceWorker'in navigator))return toast('Este navegador no admite notificaciones Push.',true);
    working=true;setUi('Activando…',{disabled:true});
    try{
      let permission=Notification.permission;
      if(permission!=='granted')permission=await Notification.requestPermission();
      if(permission!=='granted'){setUi(permission==='denied'?'🔕 Push bloqueado':'🔔 Activar notificaciones');return toast('El navegador no concedió permiso para notificaciones.',true)}
      await registerToken();toast('Notificaciones Push activadas en este dispositivo.');
    }catch(error){setUi('🔔 Reintentar Push');toast(error.message||'No fue posible activar Push.',true)}finally{working=false}
  }
  async function sendTest(){
    if(working)return;working=true;
    try{
      deviceId=deviceId||localStorage.getItem(DEVICE_PREFIX+userKey())||null;
      await api('/api/v1/notificaciones/push-v65/prueba',{method:'POST',body:JSON.stringify({deviceId})});
      toast('Push de prueba enviado.');
    }catch(error){toast(error.message||'No fue posible enviar la prueba.',true)}finally{working=false}
  }
  async function init(){
    session=resolveSession();if(!session)return;
    buildWidget();
    if(!window.isSecureContext){setUi('🔕 Push requiere HTTPS',{disabled:true});return}
    try{config=await publicConfig()}catch{setUi('🔕 Push no disponible',{disabled:true});return}
    if(!config?.enabled){setUi('🔔 Push pendiente',{disabled:true});return}
    if(!('Notification'in window)||!('serviceWorker'in navigator)){setUi('🔕 Push no compatible',{disabled:true});return}
    if(Notification.permission==='denied'){setUi('🔕 Push bloqueado',{disabled:true});return}
    if(Notification.permission!=='granted'){setUi('🔔 Activar notificaciones');return}
    setUi('Conectando Push…',{disabled:true});
    try{await registerToken()}catch(error){setUi('🔔 Reintentar Push');console.warn(MARKER,error)}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
