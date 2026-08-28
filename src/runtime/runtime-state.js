'use strict';

const startedAt = new Date();
let ready = false;
let phase = 'BOOTING';
let detail = null;

function sourceCommit() {
  const candidates = [
    ['SOURCE_COMMIT', process.env.SOURCE_COMMIT],
    ['COOLIFY_GIT_COMMIT_SHA', process.env.COOLIFY_GIT_COMMIT_SHA],
    ['GIT_COMMIT', process.env.GIT_COMMIT],
    ['COMMIT_SHA', process.env.COMMIT_SHA],
    ['GITHUB_SHA', process.env.GITHUB_SHA]
  ];
  const row = candidates.find(([, value]) => String(value || '').trim());
  return row ? { commit: String(row[1]).trim(), source: row[0] } : { commit: null, source: null };
}

function setPhase(nextPhase, nextDetail = null) {
  phase = String(nextPhase || 'UNKNOWN');
  detail = nextDetail || null;
}

function markReady() {
  ready = true;
  setPhase('READY');
}

function markNotReady(nextPhase = 'NOT_READY', nextDetail = null) {
  ready = false;
  setPhase(nextPhase, nextDetail);
}

function snapshot() {
  const build = sourceCommit();
  return {
    ready,
    phase,
    detail,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    commit: build.commit,
    commitSource: build.source,
    node: process.version,
    pid: process.pid
  };
}

module.exports = { setPhase, markReady, markNotReady, snapshot, sourceCommit };
