const fs = require('node:fs');
const path = require('node:path');
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
        synced_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_operations_queue ON operations(state, next_attempt_at, local_timestamp, created_at);
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
    `);
    this.ensureColumn('operations', 'next_attempt_at', 'TEXT');
    this.ensureColumn('local_sales', 'payment_mode', "TEXT NOT NULL DEFAULT 'CASH'");
    this.ensureColumn('local_sales', 'payment_status', "TEXT NOT NULL DEFAULT 'PAID_LOCAL'");
  }

  ensureColumn(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map((x) => x.name);
    if (!columns.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  putSnapshot(kind, version, payload) {
    const now = new Date().toISOString();
    const encrypted = encryptJson(payload, this.encryptionKey);
    this.db.prepare(`INSERT INTO snapshots(kind,version,payload_enc,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(kind) DO UPDATE SET version=excluded.version,payload_enc=excluded.payload_enc,updated_at=excluded.updated_at`).run(kind, version, encrypted, now);
  }

  getSnapshot(kind) {
    const row = this.db.prepare('SELECT kind,version,payload_enc,updated_at FROM snapshots WHERE kind=?').get(kind);
    if (!row) return null;
    return { kind: row.kind, version: row.version, updatedAt: row.updated_at, payload: decryptJson(row.payload_enc, this.encryptionKey) };
  }

  enqueueOperation(operation) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO operations(id,type,local_timestamp,state,attempts,next_attempt_at,payload_enc,created_at)
      VALUES(?,?,?,'PENDING',0,NULL,?,?)`).run(operation.id, operation.type, operation.localTimestamp, encryptJson(operation.payload, this.encryptionKey), now);
  }

  operationExists(id) {
    return Boolean(this.db.prepare('SELECT id FROM operations WHERE id=?').get(id));
  }

  listPending(limit = 200) {
    const now = new Date().toISOString();
    return this.db.prepare(`SELECT id,type,local_timestamp,state,attempts,last_error,next_attempt_at,payload_enc,created_at
      FROM operations
      WHERE state IN ('PENDING','FAILED') AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      ORDER BY local_timestamp ASC, created_at ASC LIMIT ?`).all(now, Number(limit)).map((row) => ({
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

  markSynced(id) {
    this.db.prepare("UPDATE operations SET state='SYNCED',synced_at=?,last_error=NULL,next_attempt_at=NULL WHERE id=?").run(new Date().toISOString(), id);
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
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE state IN ('PENDING','FAILED')").get();
    return Number(row?.n || 0);
  }

  pendingSummary(limit = 100) {
    return this.db.prepare(`SELECT id,type,local_timestamp,state,attempts,last_error,next_attempt_at,created_at,synced_at
      FROM operations ORDER BY created_at DESC LIMIT ?`).all(Number(limit)).map((row) => ({
        id: row.id, type: row.type, localTimestamp: row.local_timestamp, state: row.state, attempts: row.attempts,
        lastError: row.last_error, nextAttemptAt: row.next_attempt_at, createdAt: row.created_at, syncedAt: row.synced_at
      }));
  }

  saveLocalSale(sale) {
    this.db.prepare(`INSERT INTO local_sales(id,operation_id,local_number,total,cash_received,payment_mode,payment_status,payload_enc,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(sale.id, sale.operationId, sale.localNumber, sale.total, sale.cashReceived || 0, sale.paymentMode || 'CASH', sale.paymentStatus || 'PAID_LOCAL', encryptJson(sale.payload, this.encryptionKey), sale.createdAt);
  }

  recentSales(limit = 50) {
    return this.db.prepare(`SELECT id,operation_id,local_number,total,cash_received,payment_mode,payment_status,payload_enc,created_at
      FROM local_sales ORDER BY created_at DESC LIMIT ?`).all(Number(limit)).map((row) => ({
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

  recordEvent(eventType, details = {}) {
    this.db.prepare('INSERT INTO field_events(event_type,details_enc,created_at) VALUES(?,?,?)')
      .run(String(eventType), encryptJson(details, this.encryptionKey), new Date().toISOString());
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
      ON CONFLICT(product_id) DO UPDATE SET delta=stock_delta.delta+excluded.delta,updated_at=excluded.updated_at`).run(productId, Number(delta), now);
  }

  stockDelta(productId) {
    return Number(this.db.prepare('SELECT delta FROM stock_delta WHERE product_id=?').get(productId)?.delta || 0);
  }

  resetStockDeltas() {
    this.db.exec('DELETE FROM stock_delta');
  }

  close() { this.db.close(); }
}

module.exports = { EdgeStore };
