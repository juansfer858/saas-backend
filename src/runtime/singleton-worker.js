'use strict';

const { Client } = require('pg');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLease(name) {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: `vantixgc-${name}`
  });
  await client.connect();
  const result = await client.query(
    'SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired',
    [name]
  );
  if (!result.rows?.[0]?.acquired) {
    await client.end().catch(() => {});
    return null;
  }
  return client;
}

function startSingletonWorker({ name, intervalMs, initialDelayMs = 0, retryLeaseMs = 10000, task }) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está configurada para el worker');
  if (!name || typeof task !== 'function') throw new Error('Worker singleton inválido');

  let stopped = false;
  let lease = null;
  let timer = null;
  let busy = false;
  let reacquiring = false;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  async function releaseLease() {
    if (!lease) return;
    const current = lease;
    lease = null;
    try { await current.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [name]); } catch {}
    try { await current.end(); } catch {}
  }

  function scheduleTask(delayMs) {
    clearTimer();
    if (stopped || !lease) return;
    timer = setTimeout(runTask, Math.max(Number(delayMs) || 0, 0));
    timer.unref?.();
  }

  async function scheduleAcquire(delayMs = 0) {
    if (stopped || reacquiring || lease) return;
    reacquiring = true;
    if (delayMs > 0) await wait(delayMs);
    if (stopped) { reacquiring = false; return; }
    try {
      const acquired = await acquireLease(name);
      if (!acquired) {
        console.log(`WORKER_LEASE_STANDBY name=${name}`);
        reacquiring = false;
        return scheduleAcquire(retryLeaseMs);
      }
      lease = acquired;
      lease.on('error', async (error) => {
        if (stopped) return;
        console.error(`WORKER_LEASE_LOST name=${name} error=${error.message}`);
        clearTimer();
        lease = null;
        reacquiring = false;
        await scheduleAcquire(retryLeaseMs);
      });
      console.log(`WORKER_LEASE_ACQUIRED name=${name}`);
      reacquiring = false;
      scheduleTask(initialDelayMs);
    } catch (error) {
      console.error(`WORKER_LEASE_RETRY name=${name} error=${error.message}`);
      await releaseLease();
      reacquiring = false;
      return scheduleAcquire(retryLeaseMs);
    }
  }

  async function runTask() {
    if (stopped || !lease) return;
    if (!busy) {
      busy = true;
      try {
        await task();
      } catch (error) {
        console.error(`WORKER_TASK_ERROR name=${name} error=${error.message}`);
      } finally {
        busy = false;
      }
    }
    scheduleTask(intervalMs);
  }

  async function stop() {
    stopped = true;
    clearTimer();
    while (busy) await wait(25);
    await releaseLease();
    console.log(`WORKER_STOPPED name=${name}`);
  }

  scheduleAcquire().catch((error) => console.error(`WORKER_START_ERROR name=${name} error=${error.message}`));
  return { stop };
}

module.exports = { startSingletonWorker, acquireLease };
