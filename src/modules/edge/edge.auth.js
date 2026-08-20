const service = require('./edge.service');

async function edgeAuth(req, _res, next) {
  try {
    const agentId = req.get('x-vantix-edge-id');
    const edgeKey = req.get('x-vantix-edge-key');
    const agent = await service.authenticateAgent(agentId, edgeKey);
    req.edgeAgent = agent;
    req.tenantId = agent.tenantId;
    req.userId = agent.serviceUserId;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { edgeAuth };
