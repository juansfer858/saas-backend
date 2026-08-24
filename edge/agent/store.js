const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { encryptJson, decryptJson } = require('./crypto-store');

class EdgeStore {
  constructor(dbPath, encryptionKey) {
    this.dbPath = dbPath;
    this.encryptionKey = encryptionKey;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS edge_meta (
        key TEXT PRIMARY KEY,
        value_enc TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        kind TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        payload_enc TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        local_timestamp TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT,
        payload_enc TEXT NOT NULL,
        created_at TEXT NOT NULL,
        synced_at TEXT,
        origin_document_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_operations_queue ON operations(state,next_attempt_at,local_timestamp,created_at);
      CREATE TABLE IF NOT EXISTS stock_delta (
        product_id TEXT PRIMARY KEY,
        delta REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_sales (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL UNIQUE,
        local_number TEXT NOT NULL UNIQUE,
        total REAL NOT NULL,
        cash_received REAL NOT NULL DEFAULT 0,
        payment_mode TEXT NOT NULL DEFAULT 'CASH',
        payment_status TEXT NOT NULL DEFAULT 'PAID_LOCAL',
        payload_enc TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS field_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        details_enc TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_field_events_time ON field_events(created_at DESC);
      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        printer_enc TEXT NOT NULL,
        payload_enc TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        printed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_print_jobs_queue ON print_jobs(state,next_attempt_at,created_at);
      CREATE TABLE IF NOT EXISTS remote_orders (
        id TEXT PRIMARY KEY,
        channel_type TEXT NOT NULL,
        state TEXT NOT NULL,
        central_state TEXT,
        report_pending INTEGER NOT NULL DEFAULT 0,
        payload_enc TEXT NOT NULL,
        local_operation_id TEXT,
        origin_document_id TEXT,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_remote_orders_state ON remote_orders(state,created_at);
      CREATE INDEX IF NOT EXISTS idx_remote_orders_report ON remote_orders(report_pending,updated_at);
    `);
    this.ensureColumn('operations', 'next_attempt_at', 'TEXT');
    this.ensureColumn('operations', 'origin_document_id', 'TEXT');
    this.ensureColumn('local_sales', 'payment_mode', "TEXT NOT NULL DEFAULT 'CASH'");
    this.ensureColumn('local_sales', 'payment_status', "TEXT NOT NULL DEFAULT 'PAID_LOCAL'");
    this.ensureColumn('remote_orders', 'central_state', 'TEXT');
    this.ensureColumn('remote_orders', 'report_pending', 'INTEGER NOT NULL DEFAULT 0');
  }

  ensureColumn(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map((x) => x.name);
    if (!columns.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  setMeta(key, value) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO edge_meta(key,value_enc,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_enc=excluded.value_enc,updated_at=excluded.updated_at`)
      .run(key, encryptJson(value, this.encryptionKey), now);
  }

  getMeta(key) {
    const row = this.db.prepare('SELECT value_enc FROM edge_meta WHERE key=?').get(key);
    return row ? decryptJson(row.value_enc, this.encryptionKey) : null;
  }

  getOrCreateInstallationId() {
    let id = this.getMeta('installation_id');
    if (!id) {
      id = crypto.randomUUID();
      this.setMeta('installation_id', id);
    }
    return id;
  }

  putSnapshot(kind, version, payload) {
    const now = new Date().toISOString();
    const encrypted = encryptJson(payload, this.encryptionKey);
    this.db.prepare(`INSERT INTO snapshots(kind,version,payload_enc,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(kind) DO UPDATE SET version=excluded.version,payload_enc=excluded.payload_enc,updated_at=excluded.updated_at`)
      .run(kind, version, encrypted, now);
  }

  getSnapshot(kind) {
    const row = this.db.prepare('SELECT kind,version,payload_enc,updated_at FROM snapshots WHERE kind=?').get(kind);
    return row ? { kind: row.kind, version: row.version, updatedAt: row.updated_at, payload: decryptJson(row.payload_enc, this.encryptionKey) } : null;
  }

  enqueueOperation(operation) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO operations(id,type,local_timestamp,state,attempts,next_attempt_at,payload_enc,created_at)
      VALUES(?,?,?,'PENDING',0,NULL,?,?)`)
      .run(operation.id, operation.type, operation.localTimestamp, encryptJson(operation.payload, this.encryptionKey), now);
  }

  operationExists(id) {
    return Boolean(this.db.prepare('SELECT id FROM operations WHERE id=?').get(id));
  }

  listPending(limit = 200) {
    const now = new Date().toISOString();
    return this.db.prepare(`SELECT * FROM operations
      WHERE state IN ('PENDING','FAILED') AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      ORDER BY local_timestamp ASC,created_at ASC LIMIT ?`)
      .all(now, Number(limit)).map((row) => ({
        id: row.id,
        type: row.type,
        localTimestamp: row.local_timestamp,
        state: row.state,
        attempts: row.attempts,
        lastError: row.last_error,
        nextAttemptAt: row.next_attempt_at,
        payload: decryptJson(row.payload_enc, this.encryptionKey),
        createdAt: row.created_at
      }));
  }

  markSynced(id, originDocumentId = null) {
    this.db.prepare("UPDATE operations SET state='SYNCED',synced_at=?,last_error=NULL,next_attempt_at=NULL,origin_document_id=COALESCE(?,origin_document_id) WHERE id=?")
      .run(new Date().toISOString(), originDocumentId || null, id);
  }

  markFailed(id, error, baseMs = 5000) {
    const row = this.db.prepare('SELECT attempts FROM operations WHERE id=?').get(id);
    const attempts = Number(row?.attempts || 0) + 1;
    const delay = Math.min(Math.max(500, Number(baseMs) || 5000) * (2 ** Math.min(attempts - 1, 8)), 300000);
    const nextAttemptAt = new Date(Date.now() + delay).toISOString();
    this.db.prepare("UPDATE operations SET state='FAILED',attempts=?,last_error=?,next_attempt_at=? WHERE id=?")
      .run(attempts, String(error || 'SYNC_ERROR').slice(0, 1000), nextAttemptAt, id);
    return { attempts, delayMs: delay, nextAttemptAt };
  }

  pendingCount() {
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE state IN ('PENDING','FAILED')").get()?.n || 0);
  }

  operationResult(id) {
    const row = this.db.prepare('SELECT id,type,state,synced_at,origin_document_id FROM operations WHERE id=?').get(id);
    return row ? { id: row.id, type: row.type, state: row.state, syncedAt: row.synced_at, originDocumentId: row.origin_document_id || null } : null;
  }

  pendingSummary(limit = 100) {
    return this.db.prepare('SELECT id,type,local_timestamp,state,attempts,last_error,next_attempt_at,created_at,synced_at,origin_document_id FROM operations ORDER BY created_at DESC LIMIT ?')
      .all(Number(limit)).map((row) => ({
        id: row.id,
        type: row.type,
        localTimestamp: row.local_timestamp,
        state: row.state,
        attempts: row.attempts,
        lastError: row.last_error,
        nextAttemptAt: row.next_attempt_at,
        createdAt: row.created_at,
        syncedAt: row.synced_at,
        originDocumentId: row.origin_document_id || null
      }));
  }

  saveLocalSale(sale) {
    this.db.prepare(`INSERT INTO local_sales(id,operation_id,local_number,total,cash_received,payment_mode,payment_status,payload_enc,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(sale.id, sale.operationId, sale.localNumber, sale.total, sale.cashReceived || 0, sale.paymentMode || 'CASH', sale.paymentStatus || 'PAID_LOCAL', encryptJson(sale.payload, this.encryptionKey), sale.createdAt);
  }

  recentSales(limit = 50) {
    return this.db.prepare('SELECT * FROM local_sales ORDER BY created_at DESC LIMIT ?').all(Number(limit)).map((row) => ({
      id: row.id,
      operationId: row.operation_id,
      localNumber: row.local_number,
      total: Number(row.total),
      cashReceived: Number(row.cash_received),
      paymentMode: row.payment_mode,
      paymentStatus: row.payment_status,
      createdAt: row.created_at,
      payload: decryptJson(row.payload_enc, this.encryptionKey)
    }));
  }

  enqueuePrintJob({ id = crypto.randomUUID(), role = 'DOCUMENTOS', printer, payload }) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO print_jobs(id,role,printer_enc,payload_enc,state,attempts,created_at)
      VALUES(?,?,?,?, 'PENDING',0,?)`)
      .run(id, role, encryptJson(printer || {}, this.encryptionKey), encryptJson(payload || {}, this.encryptionKey), now);
    return id;
  }

  listPendingPrintJobs(limit = 50) {
    const now = new Date().toISOString();
    return this.db.prepare(`SELECT * FROM print_jobs
      WHERE state IN ('PENDING','FAILED') AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      ORDER BY created_at ASC LIMIT ?`)
      .all(now, Number(limit)).map((row) => ({
        id: row.id,
        role: row.role,
        printer: decryptJson(row.printer_enc, this.encryptionKey),
        payload: decryptJson(row.payload_enc, this.encryptionKey),
        attempts: row.attempts,
        lastError: row.last_error,
        createdAt: row.created_at
      }));
  }

  markPrintSuccess(id) {
    this.db.prepare("UPDATE print_jobs SET state='PRINTED',printed_at=?,last_error=NULL,next_attempt_at=NULL WHERE id=?")
      .run(new Date().toISOString(), id);
  }

  markPrintFailed(id, error, baseMs = 3000) {
    const row = this.db.prepare('SELECT attempts FROM print_jobs WHERE id=?').get(id);
    const attempts = Number(row?.attempts || 0) + 1;
    const delay = Math.min(Math.max(500, baseMs) * (2 ** Math.min(attempts - 1, 7)), 120000);
    this.db.prepare("UPDATE print_jobs SET state='FAILED',attempts=?,last_error=?,next_attempt_at=? WHERE id=?")
      .run(attempts, String(error || 'PRINT_ERROR').slice(0, 1000), new Date(Date.now() + delay).toISOString(), id);
  }

  printQueueSummary(limit = 100) {
    return this.db.prepare('SELECT id,role,state,attempts,last_error,next_attempt_at,created_at,printed_at FROM print_jobs ORDER BY created_at DESC LIMIT ?')
      .all(Number(limit)).map((row) => ({
        id: row.id,
        role: row.role,
        state: row.state,
        attempts: row.attempts,
        lastError: row.last_error,
        nextAttemptAt: row.next_attempt_at,
        createdAt: row.created_at,
        printedAt: row.printed_at
      }));
  }

  upsertRemoteOrder(order) {
    const now = new Date().toISOString();
    const created = order.creadoEn ? new Date(order.creadoEn).toISOString() : now;
    const existing = this.db.prepare('SELECT state,central_state,report_pending,local_operation_id,origin_document_id,payload_enc FROM remote_orders WHERE id=?').get(order.id);
    if (!existing) {
      this.db.prepare(`INSERT INTO remote_orders(id,channel_type,state,central_state,report_pending,payload_enc,local_operation_id,origin_document_id,updated_at,created_at)
        VALUES(?,?,?,?,0,?,?,?,?,?)`)
        .run(order.id, order.channelType, order.state, order.state, encryptJson(order, this.encryptionKey), order.localOperationId || null, order.originDocumentId || null, now, created);
      return this.getRemoteOrder(order.id);
    }
    const pending = Number(existing.report_pending || 0) === 1;
    const localPayload = decryptJson(existing.payload_enc, this.encryptionKey);
    const merged = { ...order };
    if (pending) {
      merged.state = existing.state;
      merged.localOperationId = existing.local_operation_id || localPayload.localOperationId || null;
      merged.originDocumentId = existing.origin_document_id || localPayload.originDocumentId || null;
    }
    this.db.prepare(`UPDATE remote_orders SET channel_type=?,state=?,central_state=?,payload_enc=?,local_operation_id=?,origin_document_id=?,updated_at=? WHERE id=?`)
      .run(order.channelType, pending ? existing.state : order.state, order.state, encryptJson(merged, this.encryptionKey), merged.localOperationId || null, merged.originDocumentId || null, now, order.id);
    return this.getRemoteOrder(order.id);
  }

  getRemoteOrder(id) {
    const row = this.db.prepare('SELECT * FROM remote_orders WHERE id=?').get(id);
    if (!row) return null;
    return {
      ...decryptJson(row.payload_enc, this.encryptionKey),
      state: row.state,
      centralState: row.central_state || row.state,
      reportPending: Boolean(row.report_pending),
      localOperationId: row.local_operation_id || null,
      originDocumentId: row.origin_document_id || null
    };
  }

  listRemoteOrders(limit = 100) {
    return this.db.prepare('SELECT id FROM remote_orders ORDER BY created_at DESC LIMIT ?').all(Number(limit)).map((row) => this.getRemoteOrder(row.id));
  }

  setRemoteOrderLocalState(id, state, { localOperationId, originDocumentId } = {}) {
    const current = this.getRemoteOrder(id);
    if (!current) return null;
    const payload = {
      ...current,
      state,
      localOperationId: localOperationId || current.localOperationId || null,
      originDocumentId: originDocumentId || current.originDocumentId || null
    };
    this.db.prepare(`UPDATE remote_orders SET state=?,report_pending=1,payload_enc=?,local_operation_id=?,origin_document_id=?,updated_at=? WHERE id=?`)
      .run(state, encryptJson(payload, this.encryptionKey), payload.localOperationId, payload.originDocumentId, new Date().toISOString(), id);
    return this.getRemoteOrder(id);
  }

  listPendingRemoteReports(limit = 100) {
    return this.db.prepare('SELECT id FROM remote_orders WHERE report_pending=1 ORDER BY updated_at ASC LIMIT ?').all(Number(limit)).map((row) => this.getRemoteOrder(row.id));
  }

  markRemoteReportSynced(id, remote = {}) {
    const current = this.getRemoteOrder(id);
    if (!current) return null;
    const state = remote.state || current.state;
    const payload = {
      ...current,
      ...remote,
      state,
      localOperationId: remote.localOperationId || current.localOperationId || null,
      originDocumentId: remote.originDocumentId || current.originDocumentId || null
    };
    this.db.prepare(`UPDATE remote_orders SET state=?,central_state=?,report_pending=0,payload_enc=?,local_operation_id=?,origin_document_id=?,updated_at=? WHERE id=?`)
      .run(state, state, encryptJson(payload, this.encryptionKey), payload.localOperationId, payload.originDocumentId, new Date().toISOString(), id);
    return this.getRemoteOrder(id);
  }

  updateRemoteOrder(id, state, localOperationId = null, originDocumentId = null) {
    return this.setRemoteOrderLocalState(id, state, { localOperationId, originDocumentId });
  }

  recordEvent(type, details = {}) {
    this.db.prepare('INSERT INTO field_events(event_type,details_enc,created_at) VALUES(?,?,?)')
      .run(String(type), encryptJson(details, this.encryptionKey), new Date().toISOString());
  }

  recentEvents(limit = 200) {
    return this.db.prepare('SELECT id,event_type,details_enc,created_at FROM field_events ORDER BY id DESC LIMIT ?').all(Number(limit)).map((row) => ({
      id: row.id,
      eventType: row.event_type,
      details: decryptJson(row.details_enc, this.encryptionKey),
      createdAt: row.created_at
    }));
  }

  adjustStock(productId, delta) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO stock_delta(product_id,delta,updated_at) VALUES(?,?,?)
      ON CONFLICT(product_id) DO UPDATE SET delta=stock_delta.delta+excluded.delta,updated_at=excluded.updated_at`)
      .run(productId, Number(delta), now);
  }

  stockDelta(productId) {
    return Number(this.db.prepare('SELECT delta FROM stock_delta WHERE product_id=?').get(productId)?.delta || 0);
  }

  resetStockDeltas() {
    this.db.exec('DELETE FROM stock_delta');
  }

  close() {
    this.db.close();
  }
}

module.exports = { EdgeStore };
