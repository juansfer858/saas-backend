const state = {
  enabled: true,
  status: 'IDLE',
  attempt: 0,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastReadyAt: null
};

function sanitizeError(error) {
  const text = String(error?.message || error || 'Unknown error');
  return text.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[DATABASE_URL]').slice(0, 500);
}

function setEnabled(enabled) {
  state.enabled = Boolean(enabled);
  if (!state.enabled) state.status = 'DISABLED';
}

function markStart(attempt) {
  state.attempt = attempt;
  state.status = 'RUNNING';
  state.lastStartedAt = new Date().toISOString();
  state.lastError = null;
}

function markReady() {
  state.status = 'READY';
  state.lastFinishedAt = new Date().toISOString();
  state.lastReadyAt = state.lastFinishedAt;
  state.lastError = null;
}

function markError(error, terminal = false) {
  state.status = terminal ? 'FAILED' : 'RETRYING';
  state.lastFinishedAt = new Date().toISOString();
  state.lastError = sanitizeError(error);
}

function snapshot() {
  return { ...state };
}

module.exports = { setEnabled, markStart, markReady, markError, snapshot };
