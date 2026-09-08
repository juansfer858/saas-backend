'use strict';

const MARKER = 'VANTIX_RESTAURANT_POS_PRINT_CHOICE_V75';
const V38_TRIGGER = 'if(shouldTrigger&&response.ok)queueReceiptSync();';
const V75_TRIGGER = "if(shouldTrigger&&response.ok){const choice=window.VantixGCPosPrintChoiceV75;if(choice&&typeof choice.request==='function')choice.request(queueReceiptSync);else queueReceiptSync();}";

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_POS_PRINT_CHOICE_V75';
  if(window[MARKER])return;
  window[MARKER]=true;
  let pendingPrint=null;
  let root=null;
  let printButton=null;
  let skipButton=null;

  function ensureModal(){
    if(root&&document.body.contains(root))return root;
    root=document.createElement('div');
    root.id='vantixPosPrintChoiceV75';
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-labelledby','vantixPosPrintChoiceTitleV75');
    root.hidden=true;
    root.style.cssText='position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.48);display:none;align-items:center;justify-content:center;padding:20px;';

    const card=document.createElement('div');
    card.style.cssText='width:min(430px,100%);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.24);padding:24px;font-family:inherit;color:#18221d;';

    const title=document.createElement('h2');
    title.id='vantixPosPrintChoiceTitleV75';
    title.textContent='¿Imprimir comprobante?';
    title.style.cssText='margin:0 0 8px;font-size:21px;line-height:1.25;';

    const text=document.createElement('p');
    text.textContent='El pago ya fue registrado. Elige si deseas imprimir el comprobante ahora.';
    text.style.cssText='margin:0 0 20px;color:#61706a;font-size:15px;line-height:1.45;';

    const actions=document.createElement('div');
    actions.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:10px;';

    skipButton=document.createElement('button');
    skipButton.type='button';
    skipButton.textContent='No imprimir';
    skipButton.dataset.posPrintChoice='skip';
    skipButton.style.cssText='min-height:48px;border:1px solid #d7ddd9;border-radius:12px;background:#fff;color:#18221d;font:600 15px inherit;cursor:pointer;';

    printButton=document.createElement('button');
    printButton.type='button';
    printButton.textContent='Imprimir';
    printButton.dataset.posPrintChoice='print';
    printButton.style.cssText='min-height:48px;border:0;border-radius:12px;background:#0d6b43;color:#fff;font:700 15px inherit;cursor:pointer;';

    actions.append(skipButton,printButton);
    card.append(title,text,actions);
    root.append(card);
    document.body.append(root);

    skipButton.addEventListener('click',()=>resolve(false));
    printButton.addEventListener('click',()=>resolve(true));
    root.addEventListener('click',(event)=>{if(event.target===root)event.preventDefault();});
    return root;
  }

  function open(){
    const modal=ensureModal();
    modal.hidden=false;
    modal.style.display='flex';
    setTimeout(()=>printButton?.focus(),0);
  }

  function close(){
    if(!root)return;
    root.hidden=true;
    root.style.display='none';
  }

  function resolve(shouldPrint){
    const callback=pendingPrint;
    pendingPrint=null;
    close();
    if(!shouldPrint||typeof callback!=='function')return;
    try{callback();}catch{}
  }

  function request(printFn){
    if(typeof printFn!=='function')return false;
    pendingPrint=printFn;
    open();
    return true;
  }

  document.addEventListener('keydown',(event)=>{
    if(event.key==='Escape'&&root&&!root.hidden){
      event.preventDefault();
      resolve(false);
    }
  },true);

  window.VantixGCPosPrintChoiceV75=Object.freeze({
    marker:MARKER,
    version:'75.0.0',
    request,
    explicitChoice:true,
    paymentAlreadyRegistered:true
  });
})();
`;

function patchRestaurantUiSource(source) {
  if (typeof source !== 'string' || !source.includes('VANTIX_RESTAURANT_POS_RECEIPT_V38')) return source;
  if (source.includes(MARKER)) return source;
  if (!source.includes(V38_TRIGGER)) return source;
  return `${source.replace(V38_TRIGGER, V75_TRIGGER)}\n;${runtime}\n`;
}

function installRestaurantPosPrintChoiceV75(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    const patched = source ? patchRestaurantUiSource(source) : source;
    if (source && patched !== source) body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    res.set('X-VantixGC-POS-Print-Choice', patched && patched.includes(MARKER) ? 'v75-explicit-choice' : 'v75-hook-missing');
    return originalSend(body);
  };
  return next();
}

module.exports = {
  MARKER,
  V38_TRIGGER,
  V75_TRIGGER,
  runtime,
  patchRestaurantUiSource,
  installRestaurantPosPrintChoiceV75
};
