import {test} from 'vitest';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const schema=readFileSync(new URL('../drizzle/0001_wild_jigsaw.sql',import.meta.url),'utf8');
const priorMigration=readFileSync(new URL('../drizzle/0010_ashare_legacy_reconciliation.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../drizzle/0013_ashare_terminal_reconciliation.sql',import.meta.url),'utf8');
const statements=migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
// These are operation metadata, not market observations or success evidence.
const legacy={id:'single_upstream',status:'busy',lease_token:'d40b43df-beb2-4d2e-a839-c6298519f450',
 acquired_ms:1793871300854,finished_ms:1793871239340,updated_ms:1793871300854,not_before_ms:1793871299340,reason_code:null};
const make=(patch:Record<string,unknown>={})=>{
 const db=new DatabaseSync(':memory:');db.exec(schema);db.exec(priorMigration.split('--> statement-breakpoint')[0]);
 db.prepare(`INSERT INTO ashare_recovery_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  'synthetic_prior_audit','busy','synthetic_prior_owner',1,0,1,0,null,2,'canceled_terminal','unknown','Synthetic existing audit.');
 const row={...legacy,...patch};
 db.prepare('UPDATE ashare_source_gate SET status=?,lease_token=?,acquired_ms=?,finished_ms=?,updated_ms=?,not_before_ms=?,reason_code=?').run(
  row.status,row.lease_token,row.acquired_ms,row.finished_ms,row.updated_ms,row.not_before_ms,row.reason_code);
 return db;
};
const gate=(db:DatabaseSync)=>({...db.prepare('SELECT * FROM ashare_source_gate').get()});
const apply=(db:DatabaseSync)=>{for(const statement of statements)db.exec(statement);};
test('terminal reconciliation atomically preserves every old field and keeps unknown outcome explicit',()=>{
 const db=make();const before=gate(db);
 const prior=db.prepare("SELECT * FROM ashare_recovery_audit WHERE id='synthetic_prior_audit'").get();
 apply(db);const after=gate(db);
 assert.deepEqual(db.prepare("SELECT * FROM ashare_recovery_audit WHERE id='synthetic_prior_audit'").get(),prior);
 assert.equal(after.status,'idle');assert.equal(after.lease_token,null);assert.equal(after.reason_code,null);
 assert.equal(after.acquired_ms,before.acquired_ms);assert.equal(Number(after.not_before_ms)-Number(after.finished_ms),60000);
 const audit=db.prepare("SELECT * FROM ashare_recovery_audit WHERE id='runtime_cancel_20261105_093529'").get()!;
 for(const key of ['status','lease_token','acquired_ms','finished_ms','updated_ms','not_before_ms','reason_code'])assert.equal(audit[`prior_${key}`],before[key]);
 assert.equal(audit.invocation_outcome,'waituntil_canceled_terminal');assert.equal(audit.source_outcome,'unknown');
 assert.equal(audit.reconciled_ms,after.updated_ms);
 assert.match(String(audit.evidence),/does not attest source success/);
 assert.match(String(audit.evidence),/Gate id single_upstream/);
 assert.match(String(audit.evidence),/a51dcec4e7ce88a5c73ed04f4d3a8112/);
 assert.match(String(audit.evidence),/waitUntil/);
 assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger'").get()?.n,0);
 apply(db);assert.deepEqual(gate(db),after);assert.equal(db.prepare('SELECT count(*) AS n FROM ashare_recovery_audit').get()?.n,2);db.close();
});
for(const [name,patch] of Object.entries({
 blocked:{status:'blocked',lease_token:null,reason_code:'http_403'},
 rate_limited:{status:'blocked',lease_token:null,reason_code:'http_429'},
 challenged:{status:'blocked',lease_token:null,reason_code:'challenge'},
 idle:{status:'idle',lease_token:null},
 different_owner:{lease_token:'another-current-acquisition'},
 changed_acquisition:{acquired_ms:1793871300855},
 changed_update:{updated_ms:1793871300855},
 changed_finished:{finished_ms:1793871239341},
 changed_cooldown:{not_before_ms:1793871299341},
 missing_acquisition:{acquired_ms:null},
}))test(`migration is a no-op for ${name}; never expires or clears another gate`,()=>{
 const db=make(patch);const before=gate(db);apply(db);assert.deepEqual(gate(db),before);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ashare_recovery_audit').get()?.n,1);db.close();
});
test('failed audit write rolls back the release rather than losing evidence',()=>{
 const db=make();db.exec(statements[0]);
 db.exec("CREATE TRIGGER simulate_audit_failure BEFORE INSERT ON ashare_recovery_audit BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 const before=gate(db);assert.throws(()=>db.exec(statements[1]),/synthetic failure/);assert.deepEqual(gate(db),before);db.close();
});
test('interrupted application after audit/release does not execute reconciliation twice',()=>{
 const db=make();for(const statement of statements.slice(0,2))db.exec(statement);const after=gate(db);
 apply(db);assert.deepEqual(gate(db),after);assert.equal(db.prepare('SELECT count(*) AS n FROM ashare_recovery_audit').get()?.n,2);db.close();
});
test('new owner after reconciliation cannot be released by replayed migration',()=>{
 const db=make();apply(db);db.exec("UPDATE ashare_source_gate SET status='busy',lease_token='synthetic-new-owner',acquired_ms=1793868000000,updated_ms=1793868000000");
 const before=gate(db);apply(db);assert.deepEqual(gate(db),before);db.close();
});

test('pre-existing audit operation id cannot release the exact row again',()=>{
 const db=make();apply(db);
 db.prepare('UPDATE ashare_source_gate SET status=?,lease_token=?,acquired_ms=?,finished_ms=?,updated_ms=?,not_before_ms=?,reason_code=?').run(
  legacy.status,legacy.lease_token,legacy.acquired_ms,legacy.finished_ms,legacy.updated_ms,legacy.not_before_ms,legacy.reason_code);
 const before=gate(db);apply(db);assert.deepEqual(gate(db),before);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ashare_recovery_audit').get()?.n,2);db.close();
});
test('guard refuses execution before the documented terminal evidence window',()=>{
 const db=make();db.function('strftime',{varargs:true},format=>format==='%s'?'1793871300':'00.000');
 const before=gate(db);apply(db);assert.deepEqual(gate(db),before);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ashare_recovery_audit').get()?.n,1);db.close();
});
for(const reason of ['http_403','http_429','challenge','captcha','access_denied','login_required'])test(`terminal reconciliation preserves observed ${reason} exactly`,()=>{
 const db=make({status:'blocked',lease_token:null,reason_code:reason});const before=gate(db);
 const prior=db.prepare('SELECT * FROM ashare_recovery_audit').all();apply(db);
 assert.deepEqual(gate(db),before);assert.deepEqual(db.prepare('SELECT * FROM ashare_recovery_audit').all(),prior);db.close();
});
test('interruption after installing trigger cannot clear a newer denial',()=>{
 const db=make();db.exec(statements[0]);db.exec("UPDATE ashare_source_gate SET status='blocked',lease_token=NULL,reason_code='http_403'");
 const before=gate(db);apply(db);assert.deepEqual(gate(db),before);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ashare_recovery_audit').get()?.n,1);db.close();
});
test('terminal reconciliation leaves other provider state and stored observations unchanged',()=>{
 const db=make();
 db.exec("CREATE TABLE synthetic_other_provider(id TEXT PRIMARY KEY,status TEXT,reason TEXT); INSERT INTO synthetic_other_provider VALUES('other','blocked','http_403')");
 db.exec(readFileSync(new URL('../drizzle/0012_ashare_shared_snapshots.sql',import.meta.url),'utf8'));
 db.prepare('INSERT INTO ashare_snapshot_cache VALUES(?,?,?,?,?)').run('level1',1,'{"synthetic":true}',10,86400010);
 const other=db.prepare('SELECT * FROM synthetic_other_provider').all();const cache=db.prepare('SELECT * FROM ashare_snapshot_cache').all();
 apply(db);assert.deepEqual(db.prepare('SELECT * FROM synthetic_other_provider').all(),other);
 assert.deepEqual(db.prepare('SELECT * FROM ashare_snapshot_cache').all(),cache);db.close();
});
test('failed gate update rolls back its inserted audit as well',()=>{
 const db=make();db.exec(statements[0]);
 db.exec("CREATE TRIGGER simulate_gate_failure AFTER UPDATE ON ashare_source_gate BEGIN SELECT RAISE(ABORT,'synthetic gate failure'); END");
 const before=gate(db);const audit=db.prepare('SELECT * FROM ashare_recovery_audit').all();
 assert.throws(()=>db.exec(statements[1]),/synthetic gate failure/);assert.deepEqual(gate(db),before);
 assert.deepEqual(db.prepare('SELECT * FROM ashare_recovery_audit').all(),audit);db.close();
});
