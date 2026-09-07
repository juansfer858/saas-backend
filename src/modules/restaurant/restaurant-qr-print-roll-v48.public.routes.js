'use strict';

const QR_PRINT_ROLL_CSS = `
/* VANTIX_QR_PRINT_ROLL_V48 */
@media print {
  @page { margin: 0; }
  html, body { margin:0!important; padding:0!important; width:100%!important; min-height:0!important; background:#fff!important; }
  body.qr-print-body { width:100%!important; min-height:0!important; background:#fff!important; color:#000!important; }
  .qr-print-grid { display:block!important; width:100%!important; margin:0!important; padding:0!important; }
  .qr-print-card {
    box-sizing:border-box!important; width:100%!important; min-height:0!important; margin:0!important;
    padding:4mm 3mm 5mm!important; border:0!important; border-radius:0!important; box-shadow:none!important;
    text-align:center!important; break-inside:avoid!important; page-break-inside:avoid!important;
    break-after:page!important; page-break-after:always!important;
  }
  .qr-print-card:last-child { break-after:auto!important; page-break-after:auto!important; }
  .qr-print-brand { font-size:11pt!important; line-height:1.15!important; font-weight:900!important; }
  .qr-print-card h2 { margin:2mm 0 0!important; font-size:23pt!important; line-height:1!important; }
  .qr-print-card > p { margin:1mm 0!important; font-size:10.5pt!important; line-height:1.2!important; color:#000!important; }
  .qr-print-code { width:56mm!important; max-width:84%!important; margin:3mm auto!important; }
  .qr-print-code svg { display:block!important; width:100%!important; height:auto!important; }
  .qr-print-card h3 { margin:2mm 0 1mm!important; font-size:13pt!important; line-height:1.15!important; }
  .qr-print-card small { display:block!important; margin-top:2mm!important; max-width:100%!important; overflow-wrap:anywhere!important; color:#000!important; font-size:6.5pt!important; line-height:1.2!important; }
}
`;

function installRestaurantQrPrintRollV48(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-control-center.css') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes('VANTIX_QR_PRINT_ROLL_V48')) {
      const patched = `${source}\n${QR_PRINT_ROLL_CSS}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-QR-Print-Roll', 'v48-full-width');
    return originalSend(body);
  };
  return next();
}

module.exports = { QR_PRINT_ROLL_CSS, installRestaurantQrPrintRollV48 };
