const assert = require('node:assert/strict');
const http = require('node:http');
const hka = require('../src/modules/platform/dian/providers/the-factory-hka.provider');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close(server) { return new Promise((resolve) => server.close(resolve)); }

async function main() {
  let captured = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      captured = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ codigo: 200, resultado: 'Procesado', consecutivoDocumento: 'POSQA1', cufe: 'CUDE-DEMO-123', tipoCufe: 'CUDE-SHA384', esValidoDian: true, fechaAceptacionDIAN: '2026-08-19 18:00:00' }));
    });
  });
  const port = await listen(server);
  try {
    const config = { providerCode: 'THE_FACTORY_HKA', environment: 'HABILITACION' };
    const credentials = {
      tokenEmpresa: 'EMPRESA_TEST', tokenPassword: 'PASSWORD_TEST', documentEquivalentSendUrl: `http://127.0.0.1:${port}/EnviarRequest`,
      facturaTemplate: {
        tipoDocumento: '20', tipoOperacion: '10', consecutivoDocumento: '{{fiscalNumber}}', fechaEmision: '{{issueDateTime}}',
        totalBaseImponible: '{{subtotal}}', totalBrutoConImpuesto: '{{total}}', totalDocumento: '{{total}}', moneda: 'COP',
        cliente: { numeroDocumento: '{{customerId}}', nombreRazonSocial: '{{customerName}}' },
        fabricantesoftware: [{ identificadorSoftware: 'VANTIXGC-QA' }]
      }
    };
    const document = { id: 'doc-1', tenantId: 'tenant-1', documentType: 'DOCUMENTO_EQUIVALENTE_POS', fiscalNumber: 'POSQA1', internalNumber: 'FV-1' };
    const origin = {
      numero: 'FV-1', fecha: new Date('2026-08-19T18:00:00-05:00'), subtotal: 10000, ivaTotal: 0, impoconsumoTotal: 0, total: 10000,
      tercero: { identificacion: '222222222222', nombre: 'Consumidor final', email: null, telefono: null }, detalles: []
    };
    const ready = hka.readiness(config, credentials);
    assert.equal(ready.installed, true);
    assert.equal(ready.configured, true);
    const result = await hka.transmit({ document, config, credentials, origin });
    assert.equal(result.accepted, true);
    assert.equal(result.uniqueCode, 'CUDE-DEMO-123');
    assert.equal(captured.tokenEmpresa, 'EMPRESA_TEST');
    assert.equal(captured.tokenPassword, 'PASSWORD_TEST');
    assert.equal(captured.factura.tipoDocumento, '20');
    assert.equal(captured.factura.consecutivoDocumento, 'POSQA1');
    assert.equal(captured.factura.cliente.numeroDocumento, '222222222222');
    assert.equal(captured.factura.totalDocumento, '10000.00');

    const missing = hka.readiness(config, { tokenEmpresa: 'x' });
    assert.equal(missing.configured, false);
    assert.ok(missing.missing.includes('tokenPassword'));
    assert.ok(missing.missing.includes('documentEquivalentSendUrl'));

    console.log('HKA PROVIDER ADAPTER TRANSPORT SMOKE OK');
    console.log(JSON.stringify({ realHttpTransport: true, enviarRequestEnvelope: true, responseParsing: true, providerCredentialsRequired: true, actualHkaCredentialsUsed: false, actualDianAcceptance: false }, null, 2));
  } finally { await close(server); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
