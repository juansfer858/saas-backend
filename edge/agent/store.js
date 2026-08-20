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
        payload_enc TEXT NOT NULL,
        created_at TEXT NOT NULL,
        synced_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_operations_queue ON operations(state, local_timestamp, created_at);
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
        cash_received REAL NOT NULL,
        payload_enc TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
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
    this.db.prepare(`INSERT INTO operations(id,type,local_timestamp,state,attempts,payload_enc,created_at)
      VALUES(?,?,?,'PENDING',0,?,?)`).run(operation.id, operation.type, operation.localTimestamp, encryptJson(operation.payload, this.encryptionKey), now);
  }

  operationExists(id) {
    return Boolean(this.db.prepare('SELECT id FROM operations WHERE id=?').get(id));
  }

  listPending(limit = 200) {
    return this.db.prepare(`SELECT id,type,local_timestamp,state,attempts,last_error,payload_enc,created_at
      FROM operations WHERE state IN ('PENDING','FAILED') ORDER BY local_timestamp ASC, created_at ASC LIMIT ?`).all(Number(limit)).map((row) => ({
        id: row.id,
        type: row.type,
        localTimestamp: row.local_timestamp,
        state: row.state,
        attempts: row.attempts,
        lastError: row.last_error,
        payload: decryptJson(row.payload_enc, this.encryptionKey),
        createdAt: row.created_at
      }));
  }

  markSynced(id) {
    this.db.prepare("UPDATE operations SET state='SYNCED',synced_at=?,last_error=NULL WHERE id=?").run(new Date().toISOString(), id);
  }

  markFailed(id, error) {
    this.db.prepare("UPDATE operations SET state='FAILED',attempts=attempts+1,last_error=? WHERE id=?").run(String(error || 'SYNC_ERROR').slice(0, 1000), id);
  }

  pendingCount() {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE state IN ('PENDING','FAILED')").get();
    return Number(row?.n || 0);
  }

  saveLocalSale(sale) {
    this.db.prepare('INSERT INTO local_sales(id,operation_id,local_number,total,cash_received,payload_enc,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(sale.id, sale.operationId, sale.localNumber, sale.total, sale.cashReceived, encryptJson(sale.payload, this.encryptionKey), sale.createdAt);
  }

  recentSales(limit = 50) {
    return this.db.prepare('SELECT id,operation_id,local_number,total,cash_received,payload_enc,created_at FROM local_sales ORDER BY created_at DESC LIMIT ?').all(Number(limit)).map((row) => ({
      id: row.id,
      operationId: row.operation_id,
      localNumber: row.local_number,
      total: Number(row.total),
      cashReceived: Number(row.cash_received),
      createdAt: row.created_at,
      payload: decryptJson(row.payload_enc, this.encryptionKey)
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
