'use strict';

const MARKER = 'VANTIX_QR_TABLE_HEADER_V36';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_QR_TABLE_HEADER_V36';
  if(window[MARKER]) return;
  window[MARKER]=true;
  if(document.getElementById('restaurantQrTableHeaderV36Styles')) return;
  const style=document.createElement('style');
  style.id='restaurantQrTableHeaderV36Styles';
  style.textContent=`
    @media(max-width:560px){
      .qrv3-hero{grid-template-columns:minmax(0,1fr) minmax(116px,42%)!important;align-items:center!important}
      .qrv3-hero>div:first-child{min-width:0!important}
      .qrv3-table{width:100%!important;min-width:116px!important;max-width:none!important;overflow:hidden!important;justify-self:end!important}
      .qrv3-table>div:last-child{min-width:0!important;flex:1 1 auto!important;max-width:100%!important}
      .qrv3-table small{white-space:nowrap!important}
      .qrv3-table strong{display:block!important;max-width:100%!important;font-size:clamp(15px,4.8vw,20px)!important;line-height:1.05!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:normal!important}
    }
    @media(max-width:390px){
      .qrv3-hero{grid-template-columns:minmax(0,1fr) minmax(108px,44%)!important}
      .qrv3-table{min-width:108px!important;max-width:none!important}
      .qrv3-table-icon{width:28px!important;height:28px!important}
      .qrv3-table strong{font-size:clamp(14px,4.6vw,18px)!important}
    }
  `;
  document.head.appendChild(style);
})();
`;

function installQrTableHeaderRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-qr-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-QR-Table-Header', 'v36-flex-table-name');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installQrTableHeaderRuntime };
