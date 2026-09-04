'use strict';

const MARKER = 'VANTIX_RESTAURANT_KDS_RELIABILITY_V1';

const runtimeTail = `
;(()=>{
  const marker='${MARKER}';
  if(document.documentElement.dataset.vantixKdsReliability===marker)return;
  document.documentElement.dataset.vantixKdsReliability=marker;
  const style=document.createElement('style');
  style.id='vantix-kds-reliability-v1';
  style.textContent='.kds-v2-lane[hidden]:has(.kds-command-card){display:block!important}.kds-kpi:first-child{cursor:pointer}.kds-kpi:first-child:focus{outline:2px solid currentColor;outline-offset:3px}';
  document.head.appendChild(style);
  document.addEventListener('click',(event)=>{
    const card=event.target?.closest?.('.kds-kpi');
    if(!card)return;
    const label=String(card.querySelector('small')?.textContent||'').trim().toLowerCase();
    if(label!=='pendientes')return;
    document.querySelector('[data-kds-filter="PENDIENTE"]')?.click();
  });
})();`;

function patchKdsRuntime(source) {
  let out = String(source || '');
  if (!out || out.includes(MARKER)) return out;
  const filterNeedle = 'const filtered = visible.filter(kdsMatches);';
  const filterReplacement = `let filtered = visible.filter(kdsMatches);\n    const pendingSafety = visible.filter((command) => command.state === 'PENDIENTE');\n    if (!filtered.length && pendingSafety.length) filtered = pendingSafety;`;
  if (!out.includes(filterNeedle)) throw new Error('RESTAURANT_KDS_FILTER_PATCH_TARGET_NOT_FOUND');
  out = `/* ${MARKER} */\n${out.replace(filterNeedle, filterReplacement)}${runtimeTail}`;
  return out;
}

function installKdsReliabilityRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const patched = patchKdsRuntime(source);
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      res.set('X-VantixGC-KDS-Reliability', 'v1-visible-pending');
    }
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, patchKdsRuntime, installKdsReliabilityRuntime };
