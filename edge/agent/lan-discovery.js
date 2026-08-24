const dgram = require('node:dgram');
const os = require('node:os');

const PROBE = 'VANTIXGC_EDGE_DISCOVER_V1';
const ANNOUNCE = 'VANTIXGC_EDGE_ANNOUNCE_V1';

function privateAddresses() {
  const rows = [];
  for (const values of Object.values(os.networkInterfaces())) {
    for (const info of values || []) {
      if (info.family === 'IPv4' && !info.internal) rows.push(info.address);
    }
  }
  return rows;
}

function startLanDiscovery({ installationId, pointCode, httpPort, discoveryPort = 8789, intervalMs = 10000, onError = () => {} }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const payload = () => Buffer.from(JSON.stringify({
    protocol: ANNOUNCE,
    installationId,
    pointCode: pointCode || null,
    httpPort: Number(httpPort),
    addresses: privateAddresses(),
    ts: Date.now()
  }));

  function broadcast() {
    try {
      socket.setBroadcast(true);
      socket.send(payload(), 0, payload().length, Number(discoveryPort), '255.255.255.255');
    } catch (error) { onError(error); }
  }

  socket.on('message', (msg, rinfo) => {
    if (msg.toString('utf8').trim() !== PROBE) return;
    try { socket.send(payload(), rinfo.port, rinfo.address); } catch (error) { onError(error); }
  });
  socket.on('error', onError);
  socket.bind(Number(discoveryPort), '0.0.0.0', () => broadcast());
  const timer = setInterval(broadcast, Math.max(Number(intervalMs) || 10000, 3000));
  timer.unref();
  return { close() { clearInterval(timer); try { socket.close(); } catch {} }, protocol: { probe: PROBE, announce: ANNOUNCE } };
}

module.exports = { startLanDiscovery, privateAddresses, PROBE, ANNOUNCE };
