'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { MARKER: PRINT_TEMPLATE_MARKER, browserRuntime: printTemplateBrowserRuntime } = require('./restaurant-print-template-ui.public.routes');
const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'p6-kds-realtime-push';
const PRINT_TEMPLATE_HEADER = 'v4.1-kds-native';
const PRINT_TEMPLATE_KDS_MARKER = 'VANTIX_RESTAURANT_PRINT_TEMPLATE_KDS_V4_1';

function kdsPrintTemplateBridgeInstaller(){
  'use strict';
  const MARKER = 'VANTIX_RESTAURANT_PRINT_TEMPLATE_KDS_V4_1';
  if (window[MARKER]) return;
  window[MARKER] = true;

  function openEditor(dialog){
    dialog?.close?.();
    requestAnimationFrame(() => {
      if (typeof window.RestaurantPrintTemplates?.open === 'function') {
        window.RestaurantPrintTemplates.open();
        return;
      }
      window.dispatchEvent(new Event('vantix:restaurant-print-template:open'));
    });
  }

  function mount(){
    const dialog = document.querySelector('#rv2StationManagerV23');
    if (!dialog || !dialog.open || dialog.querySelector('[data-rkds-print-template]')) return;
    const actions = dialog.querySelector('.rv2-station-actions');
    const newButton = actions?.querySelector('[data-station-new]');
    if (!actions || !newButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rv2-btn';
    button.dataset.rkdsPrintTemplate = 'true';
    button.textContent = '🧾 Plantilla comanda';
    button.title = 'Editar diseño de las comandas';
    button.addEventListener('click', () => openEditor(dialog));
    actions.insertBefore(button, newButton);
  }

  const observer = new MutationObserver(() => mount());
  observer.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-rv2-stations-v23]')) requestAnimationFrame(mount);
  }, true);
  mount();
}

const printTemplateKdsBridgeRuntime = `(${kdsPrintTemplateBridgeInstaller.toString()})();`;

function send(res,file,type){res.set('Cache-Control','no-store, max-age=0');res.set('X-VantixGC-Restaurant-V2-KDS',HEADER_VALUE);if(type)res.type(type);return res.sendFile(path.join(webRoot,file))}
function sendStationsWithPrintTemplate(res){
  res.set('Cache-Control','no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V2-KDS',HEADER_VALUE);
  res.set('X-VantixGC-Print-Template-Editor',PRINT_TEMPLATE_HEADER);
  res.type('application/javascript; charset=utf-8');
  const source = fs.readFileSync(path.join(webRoot,'restaurant-v2-kds-stations-v23.js'),'utf8');
  const withEditor = source.includes(PRINT_TEMPLATE_MARKER) ? source : `${source}\n;${printTemplateBrowserRuntime}\n`;
  const patched = withEditor.includes(PRINT_TEMPLATE_KDS_MARKER) ? withEditor : `${withEditor}\n;${printTemplateKdsBridgeRuntime}\n`;
  return res.send(patched);
}
router.get('/app/restaurante-v2/kds',(_req,res)=>send(res,'restaurant-v2-kds.html','html'));
router.get('/app/restaurant-v2-kds.js',(_req,res)=>send(res,'restaurant-v2-kds.js','application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-kds-stations-v23.js',(_req,res)=>sendStationsWithPrintTemplate(res));
router.get('/app/restaurant-v2-kds-printer-hybrid-v24.js',(_req,res)=>send(res,'restaurant-v2-kds-printer-hybrid-v24.js','application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-kds.css',(_req,res)=>send(res,'restaurant-v2-kds.css','text/css; charset=utf-8'));
router.get('/app/restaurant-v2-realtime.js',(_req,res)=>send(res,'vantix-tenant-realtime.js','application/javascript; charset=utf-8'));

module.exports = { HEADER_VALUE, PRINT_TEMPLATE_HEADER, PRINT_TEMPLATE_KDS_MARKER, restaurantV2KdsPublicRouter:router };