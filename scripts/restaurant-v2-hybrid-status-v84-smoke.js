'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const must = (value, needle, label) => {
  if (!value.includes(needle)) throw new Error(`${label}: falta ${needle}`);
};

const shellHtml = read('src/web/restaurant-v2-native-control-p11.html');
const shellJs = read('src/web/restaurant-v2-native-control-p11.js');
const hybridCss = read('src/web/restaurant-v2-hybrid-status-v84.css');
const adminHtml = read('src/web/restaurant-v2-admin-parity.html');
const adminJs = read('src/web/restaurant-v2-admin-parity.js');
const route = read('src/modules/restaurant/restaurant-v1-retirement-p11.public.routes.js');

must(shellHtml, 'id="p11HybridStatus"', 'shell');
must(shellHtml, '/app/restaurant-v2-hybrid-status-v84.css?v=v84', 'shell css');
must(shellJs, 'VANTIX_RESTAURANT_V2_HYBRID_STATUS_V84', 'marker shell');
must(shellJs, '/api/v1/edge/installations', 'telemetría Edge shell');
must(shellJs, 'item?.installation?.online === true', 'payload real Edge online');
must(shellJs, 'item?.installation?.softwareVersion', 'versión Edge real');
must(shellJs, 'HÍBRIDO · Edge en línea', 'estado online');
must(shellJs, 'HÍBRIDO · Edge sin conexión', 'estado offline');
must(shellJs, 'Nube activa · la operación sigue por Internet', 'fallback nube');
must(shellJs, "openModule('devices', true, HYBRID_SECTION)", 'enlace a Dispositivos');
must(shellJs, "const HYBRID_SECTION = 'estado-local-nube'", 'sección híbrida');

must(hybridCss, 'VANTIX_RESTAURANT_V2_HYBRID_STATUS_V84', 'css marker');
must(hybridCss, '.p11-hybrid-status', 'franja persistente');
must(hybridCss, '.hybrid-state-panel', 'panel local/nube');

must(adminHtml, 'id="estado-local-nube"', 'sección Dispositivos');
must(adminHtml, '>Estado local y nube<', 'título Dispositivos');
must(adminHtml, 'Una desconexión de Edge no bloquea pedidos, caja ni la operación disponible por nube.', 'contrato no bloqueante');
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

console.log('RESTAURANT_V2_HYBRID_STATUS_V84_OK');
