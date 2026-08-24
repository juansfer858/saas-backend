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
      CREATE TABLE IF NOT EXISTS edge_meta (key TEXT PRIMARY KEY, value_enc TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (kind TEXT PRIMARY KEY,version TEXT NOT NULL,payload_enc TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY,type TEXT NOT NULL,local_timestamp TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,next_attempt_at TEXT,payload_enc TEXT NOT NULL,created_at TEXT NOT NULL,synced_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_operations_queue ON operations(state,next_attempt_at,local_timestamp,created_at);
      CREATE TABLE IF NOT EXISTS stock_delta (product_id TEXT PRIMARY KEY,delta REAL NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_sales (id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,local_number TEXT NOT NULL UNIQUE,total REAL NOT NULL,cash_received REAL NOT NULL DEFAULT 0,payment_mode TEXT NOT NULL DEFAULT 'CASH',payment_status TEXT NOT NULL DEFAULT 'PAID_LOCAL',payload_enc TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS field_events (id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_enc TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_field_events_time ON field_events(created_at DESC);
      CREATE TABLE IF NOT EXISTS print_jobs (id TEXT PRIMARY KEY,role TEXT NOT NULL,printer_enc TEXT NOT NULL,payload_enc TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,next_attempt_at TEXT,created_at TEXT NOT NULL,printed_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_print_jobs_queue ON print_jobs(state,next_attempt_at,created_at);
      CREATE TABLE IF NOT EXISTS remote_orders (id TEXT PRIMARY KEY,channel_type TEXT NOT NULL,state TEXT NOT NULL,payload_enc TEXT NOT NULL,local_operation_id TEXT,origin_document_id TEXT,updated_at TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_remote_orders_state ON remote_orders(state,created_at);
    `);
    this.ensureColumn('operations','next_attempt_at','TEXT');
    this.ensureColumn('local_sales','payment_mode',"TEXT NOT NULL DEFAULT 'CASH'");
    this.ensureColumn('local_sales','payment_status',"TEXT NOT NULL DEFAULT 'PAID_LOCAL'");
  }

  ensureColumn(table,column,definition){const columns=this.db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name);if(!columns.includes(column))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)}
  setMeta(key,value){const now=new Date().toISOString();this.db.prepare(`INSERT INTO edge_meta(key,value_enc,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_enc=excluded.value_enc,updated_at=excluded.updated_at`).run(key,encryptJson(value,this.encryptionKey),now)}
  getMeta(key){const r=this.db.prepare('SELECT value_enc FROM edge_meta WHERE key=?').get(key);return r?decryptJson(r.value_enc,this.encryptionKey):null}
  getOrCreateInstallationId(){let id=this.getMeta('installation_id');if(!id){id=crypto.randomUUID();this.setMeta('installation_id',id)}return id}

  putSnapshot(kind,version,payload){const now=new Date().toISOString(),e=encryptJson(payload,this.encryptionKey);this.db.prepare(`INSERT INTO snapshots(kind,version,payload_enc,updated_at) VALUES(?,?,?,?) ON CONFLICT(kind) DO UPDATE SET version=excluded.version,payload_enc=excluded.payload_enc,updated_at=excluded.updated_at`).run(kind,version,e,now)}
  getSnapshot(kind){const r=this.db.prepare('SELECT kind,version,payload_enc,updated_at FROM snapshots WHERE kind=?').get(kind);return r?{kind:r.kind,version:r.version,updatedAt:r.updated_at,payload:decryptJson(r.payload_enc,this.encryptionKey)}:null}

  enqueueOperation(o){const now=new Date().toISOString();this.db.prepare(`INSERT INTO operations(id,type,local_timestamp,state,attempts,next_attempt_at,payload_enc,created_at) VALUES(?,?,?,'PENDING',0,NULL,?,?)`).run(o.id,o.type,o.localTimestamp,encryptJson(o.payload,this.encryptionKey),now)}
  operationExists(id){return Boolean(this.db.prepare('SELECT id FROM operations WHERE id=?').get(id))}
  listPending(limit=200){const now=new Date().toISOString();return this.db.prepare(`SELECT * FROM operations WHERE state IN ('PENDING','FAILED') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY local_timestamp ASC,created_at ASC LIMIT ?`).all(now,Number(limit)).map(r=>({id:r.id,type:r.type,localTimestamp:r.local_timestamp,state:r.state,attempts:r.attempts,lastError:r.last_error,nextAttemptAt:r.next_attempt_at,payload:decryptJson(r.payload_enc,this.encryptionKey),createdAt:r.created_at}))}
  markSynced(id){this.db.prepare("UPDATE operations SET state='SYNCED',synced_at=?,last_error=NULL,next_attempt_at=NULL WHERE id=?").run(new Date().toISOString(),id)}
  markFailed(id,error,baseMs=5000){const r=this.db.prepare('SELECT attempts FROM operations WHERE id=?').get(id),attempts=Number(r?.attempts||0)+1,delay=Math.min(Math.max(500,Number(baseMs)||5000)*(2**Math.min(attempts-1,8)),300000),nextAttemptAt=new Date(Date.now()+delay).toISOString();this.db.prepare("UPDATE operations SET state='FAILED',attempts=?,last_error=?,next_attempt_at=? WHERE id=?").run(attempts,String(error||'SYNC_ERROR').slice(0,1000),nextAttemptAt,id);return{attempts,delayMs:delay,nextAttemptAt}}
  pendingCount(){return Number(this.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE state IN ('PENDING','FAILED')").get()?.n||0)}
  pendingSummary(limit=100){return this.db.prepare('SELECT id,type,local_timestamp,state,attempts,last_error,next_attempt_at,created_at,synced_at FROM operations ORDER BY created_at DESC LIMIT ?').all(Number(limit)).map(r=>({id:r.id,type:r.type,localTimestamp:r.local_timestamp,state:r.state,attempts:r.attempts,lastError:r.last_error,nextAttemptAt:r.next_attempt_at,createdAt:r.created_at,syncedAt:r.synced_at}))}

  saveLocalSale(s){this.db.prepare(`INSERT INTO local_sales(id,operation_id,local_number,total,cash_received,payment_mode,payment_status,payload_enc,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(s.id,s.operationId,s.localNumber,s.total,s.cashReceived||0,s.paymentMode||'CASH',s.paymentStatus||'PAID_LOCAL',encryptJson(s.payload,this.encryptionKey),s.createdAt)}
  recentSales(limit=50){return this.db.prepare('SELECT * FROM local_sales ORDER BY created_at DESC LIMIT ?').all(Number(limit)).map(r=>({id:r.id,operationId:r.operation_id,localNumber:r.local_number,total:Number(r.total),cashReceived:Number(r.cash_received),paymentMode:r.payment_mode,paymentStatus:r.payment_status,createdAt:r.created_at,payload:decryptJson(r.payload_enc,this.encryptionKey)}))}

  enqueuePrintJob({id=crypto.randomUUID(),role='DOCUMENTOS',printer,payload}){const now=new Date().toISOString();this.db.prepare(`INSERT INTO print_jobs(id,role,printer_enc,payload_enc,state,attempts,created_at) VALUES(?,?,?,?, 'PENDING',0,?)`).run(id,role,encryptJson(printer||{},this.encryptionKey),encryptJson(payload||{},this.encryptionKey),now);return id}
  listPendingPrintJobs(limit=50){const now=new Date().toISOString();return this.db.prepare(`SELECT * FROM print_jobs WHERE state IN ('PENDING','FAILED') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at ASC LIMIT ?`).all(now,Number(limit)).map(r=>({id:r.id,role:r.role,printer:decryptJson(r.printer_enc,this.encryptionKey),payload:decryptJson(r.payload_enc,this.encryptionKey),attempts:r.attempts,lastError:r.last_error,createdAt:r.created_at}))}
  markPrintSuccess(id){this.db.prepare("UPDATE print_jobs SET state='PRINTED',printed_at=?,last_error=NULL,next_attempt_at=NULL WHERE id=?").run(new Date().toISOString(),id)}
  markPrintFailed(id,error,baseMs=3000){const r=this.db.prepare('SELECT attempts FROM print_jobs WHERE id=?').get(id),attempts=Number(r?.attempts||0)+1,delay=Math.min(Math.max(500,baseMs)*(2**Math.min(attempts-1,7)),120000);this.db.prepare("UPDATE print_jobs SET state='FAILED',attempts=?,last_error=?,next_attempt_at=? WHERE id=?").run(attempts,String(error||'PRINT_ERROR').slice(0,1000),new Date(Date.now()+delay).toISOString(),id)}
  printQueueSummary(limit=100){return this.db.prepare('SELECT id,role,state,attempts,last_error,next_attempt_at,created_at,printed_at FROM print_jobs ORDER BY created_at DESC LIMIT ?').all(Number(limit)).map(r=>({id:r.id,role:r.role,state:r.state,attempts:r.attempts,lastError:r.last_error,nextAttemptAt:r.next_attempt_at,createdAt:r.created_at,printedAt:r.printed_at}))}

  upsertRemoteOrder(order){const now=new Date().toISOString(),created=order.creadoEn?new Date(order.creadoEn).toISOString():now;this.db.prepare(`INSERT INTO remote_orders(id,channel_type,state,payload_enc,local_operation_id,origin_document_id,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET channel_type=excluded.channel_type,state=excluded.state,payload_enc=excluded.payload_enc,local_operation_id=excluded.local_operation_id,origin_document_id=excluded.origin_document_id,updated_at=excluded.updated_at`).run(order.id,order.channelType,order.state,encryptJson(order,this.encryptionKey),order.localOperationId||null,order.originDocumentId||null,now,created)}
  listRemoteOrders(limit=100){return this.db.prepare('SELECT * FROM remote_orders ORDER BY created_at DESC LIMIT ?').all(Number(limit)).map(r=>({...decryptJson(r.payload_enc,this.encryptionKey),state:r.state,localOperationId:r.local_operation_id,originDocumentId:r.origin_document_id}))}
  updateRemoteOrder(id,state,localOperationId=null,originDocumentId=null){const r=this.db.prepare('SELECT payload_enc FROM remote_orders WHERE id=?').get(id);if(!r)return null;const p=decryptJson(r.payload_enc,this.encryptionKey);p.state=state;if(localOperationId)p.localOperationId=localOperationId;if(originDocumentId)p.originDocumentId=originDocumentId;this.db.prepare('UPDATE remote_orders SET state=?,payload_enc=?,local_operation_id=?,origin_document_id=?,updated_at=? WHERE id=?').run(state,encryptJson(p,this.encryptionKey),p.localOperationId||null,p.originDocumentId||null,new Date().toISOString(),id);return p}

  recordEvent(type,details={}){this.db.prepare('INSERT INTO field_events(event_type,details_enc,created_at) VALUES(?,?,?)').run(String(type),encryptJson(details,this.encryptionKey),new Date().toISOString())}
  recentEvents(limit=200){return this.db.prepare('SELECT id,event_type,details_enc,created_at FROM field_events ORDER BY id DESC LIMIT ?').all(Number(limit)).map(r=>({id:r.id,eventType:r.event_type,details:decryptJson(r.details_enc,this.encryptionKey),createdAt:r.created_at}))}
  adjustStock(productId,delta){const now=new Date().toISOString();this.db.prepare(`INSERT INTO stock_delta(product_id,delta,updated_at) VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET delta=stock_delta.delta+excluded.delta,updated_at=excluded.updated_at`).run(productId,Number(delta),now)}
  stockDelta(productId){return Number(this.db.prepare('SELECT delta FROM stock_delta WHERE product_id=?').get(productId)?.delta||0)}
  resetStockDeltas(){this.db.exec('DELETE FROM stock_delta')}
  close(){this.db.close()}
}
module.exports={EdgeStore};
