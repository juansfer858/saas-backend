'use strict';

async function claimNextPrintJob(client, tenantId) {
  await client.query('BEGIN');
  try {
    const result = await client.query(`
      WITH candidate AS (
        SELECT job_id
        FROM p13_local_print_queue
        WHERE tenant_id=$1
          AND status IN ('PENDING','FAILED')
          AND available_at <= NOW()
        ORDER BY created_at ASC, job_id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE p13_local_print_queue q
      SET status='PRINTING',
          attempts=q.attempts + 1,
          claimed_at=NOW(),
          last_error=NULL,
          updated_at=NOW()
      FROM candidate
      WHERE q.job_id=candidate.job_id
      RETURNING q.*
    `, [tenantId]);
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function markPrintFailed(client, tenantId, jobId, errorMessage, retryDelaySeconds = 0) {
  const delay = Math.max(0, Math.min(Number(retryDelaySeconds) || 0, 3600));
  const result = await client.query(`
    UPDATE p13_local_print_queue
    SET status='FAILED',
        last_error=$3,
        available_at=NOW() + ($4::text || ' seconds')::interval,
        updated_at=NOW()
    WHERE tenant_id=$1 AND job_id=$2 AND status='PRINTING'
    RETURNING *
  `, [tenantId, jobId, String(errorMessage || 'PRINT_ERROR').slice(0, 1000), delay]);
  return result.rows[0] || null;
}

async function markPrintSucceeded(client, tenantId, jobId) {
  const result = await client.query(`
    UPDATE p13_local_print_queue
    SET status='PRINTED',
        printed_at=COALESCE(printed_at, NOW()),
        claimed_at=NULL,
        last_error=NULL,
        updated_at=NOW()
    WHERE tenant_id=$1 AND job_id=$2 AND status IN ('PRINTING','PRINTED')
    RETURNING *
  `, [tenantId, jobId]);
  return result.rows[0] || null;
}

async function recoverStaleClaims(client, tenantId, staleSeconds = 120) {
  const seconds = Math.max(10, Math.min(Number(staleSeconds) || 120, 86400));
  const result = await client.query(`
    UPDATE p13_local_print_queue
    SET status='PENDING',
        claimed_at=NULL,
        last_error=COALESCE(last_error, 'RECOVERED_AFTER_RESTART'),
        available_at=NOW(),
        updated_at=NOW()
    WHERE tenant_id=$1
      AND status='PRINTING'
      AND claimed_at < NOW() - ($2::text || ' seconds')::interval
    RETURNING job_id
  `, [tenantId, seconds]);
  return result.rows.map((row) => row.job_id);
}

module.exports = {
  claimNextPrintJob,
  markPrintFailed,
  markPrintSucceeded,
  recoverStaleClaims
};
