const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

function runEdgeSyncContext(context, fn) {
  return storage.run(Object.freeze({
    allowNegativeInventory: Boolean(context?.allowNegativeInventory),
    edgeAgentId: context?.edgeAgentId || null,
    operationId: context?.operationId || null,
    tenantId: context?.tenantId || null
  }), fn);
}

function getEdgeSyncContext() {
  return storage.getStore() || null;
}

module.exports = { runEdgeSyncContext, getEdgeSyncContext };
