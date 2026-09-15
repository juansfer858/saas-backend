'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const must = (value, needle, label) => {
  if (!value.includes(needle)) throw new Error(`${label}: falta ${needle}`);
};
const mustNot = (value, needle, label) => {
  if (value.includes(needle)) throw new Error(`${label}: no debe contener ${needle}`);
};

const shellHtml = read('src/web/restaurant-v2-native-control-p11.html');
const shellJs = read('src/web/restaurant-v2-native-control-p11.js');
const hybridCss = read('src/web/restaurant-v2-hybrid-status-v84.css');
const p13Detector = read('src/web/restaurant-v2-hybrid-p13-detector-v1.js');
const adminHtml = read('src/web/restaurant-v2-admin-parity.html');
const adminJs = read('src/web/restaurant-v2-admin-parity.js');
const route = read('src/modules/restaurant/restaurant-v1-retirement-p11.public.routes.js');

must(shellHtml, 'id="p11HybridStatus"', 'shell');
must(shellHtml, '/app/restaurant-v2-hybrid-status-v84.css?v=v84-p13-v1', 'shell css');
must(shellHtml, '/app/restaurant-v2-hybrid-p13-detector-v1.js?v=p13-detector-v1', 'detector shell');
must(shellHtml, 'LOCAL · Comprobando P13…', 'estado inicial P13');
must(shellJs, 'VANTIX_RESTAURANT_V2_HYBRID_STATUS_V84', 'marker shell');
must(shellJs, '/api/v1/edge/installations', 'telemetría Edge shell');
must(shellJs, 'item?.installation?.online === true', 'payload real Edge online');
must(shellJs, 'item?.installation?.softwareVersion', 'versión Edge real');
must(shellJs, 'HÍBRIDO · Edge en línea', 'estado Edge heredado online');
must(shellJs, 'HÍBRIDO · Edge sin conexión', 'estado Edge heredado offline');
must(shellJs, "openModule('devices', true, HYBRID_SECTION)", 'enlace a Dispositivos');
must(shellJs, "const HYBRID_SECTION = 'estado-local-nube'", 'sección híbrida');

must(p13Detector, 'VANTIX_RESTAURANT_HYBRID_P13_DETECTOR_V1', 'marker detector');
must(p13Detector, 'VANTIX_RESTAURANT_FULL_LOCAL_P13_A', 'marker runtime P13');
must(p13Detector, "const P13_PORT='8790'", 'puerto P13 fijo');
must(p13Detector, 'http://127.0.0.1:${P13_PORT}/__p13/status', 'probe loopback P13');
must(p13Detector, 'String(body?.tenantSubdomain||\'\').toLowerCase()===String(session.subdomain||\'\').toLowerCase()', 'binding tenant P13');
must(p13Detector, 'Number(body?.productionEdgePortUntouched)===8788', 'aislamiento Edge 8788');
must(p13Detector, "label:'LOCAL P13 DISPONIBLE'", 'estado P13 disponible');
must(p13Detector, "label:'LOCAL P13 NO DISPONIBLE · Edge respaldo en línea'", 'fallback Edge heredado');
must(p13Detector, "label:'LOCAL NO DISPONIBLE'", 'estado local ausente');
must(p13Detector, 'automaticFailover:false', 'sin failover automático en esta fase');
mustNot(p13Detector, 'location.replace(P13_STATUS_URL', 'detector no navega a P13');
mustNot(p13Detector, 'location.assign(P13_STATUS_URL', 'detector no navega a P13');

must(hybridCss, 'VANTIX_RESTAURANT_V2_HYBRID_STATUS_V84', 'css marker');
must(hybridCss, '.p11-hybrid-status', 'franja persistente');
must(hybridCss, '.hybrid-state-panel', 'panel local/nube');
must(hybridCss, 'grid-template-columns:repeat(3,minmax(0,1fr))', 'tres estados nube P13 Edge');

must(adminHtml, 'id="estado-local-nube"', 'sección Dispositivos');
must(adminHtml, '>Estado local y nube<', 'título Dispositivos');
must(adminHtml, 'id="hybridP13Status"', 'estado P13 admin');
must(adminHtml, '>Motor local P13<', 'tarjeta P13 admin');
must(adminHtml, '>Edge heredado<', 'tarjeta Edge heredado');
must(adminHtml, 'todavía no cambia automáticamente el origen de operación', 'contrato informativo sin failover');
must(adminHtml, '/app/restaurant-v2-hybrid-p13-detector-v1.js?v=p13-detector-v1', 'detector admin');
must(adminJs, 'VANTIX_RESTAURANT_V2_HYBRID_STATUS_V84', 'marker admin');
must(adminJs, 'VANTIX_RESTAURANT_V2_HYBRID_STATUS_V84_2_REAL_PAYLOAD', 'marker admin payload real');
must(adminJs, "V.api('/api/v1/edge/installations')", 'telemetría Edge admin');
must(adminJs, 'row?.installation?.online===true', 'online real admin');
must(adminJs, 'row?.installation?.softwareVersion', 'versión real admin');
must(adminJs, 'row?.installation?.lastHeartbeatAt', 'último heartbeat real admin');
must(adminJs, "installation.os||row?.platform", 'plataforma real admin');
must(adminJs, "edgeHeartbeatLabel(selected)", 'estado heartbeat derivado admin');
must(adminJs, 'renderHybridUnavailable(error)', 'degradación segura');
must(route, "router.get('/app/restaurant-v2-hybrid-status-v84.css'", 'ruta css pública');
must(route, "router.get('/app/restaurant-v2-hybrid-p13-detector-v1.js'", 'ruta detector P13 pública');

console.log('RESTAURANT_V2_HYBRID_STATUS_V84_P13_DETECTOR_OK');
