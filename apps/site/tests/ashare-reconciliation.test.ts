import {test} from 'vitest';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const schema=readFileSync(new URL('../drizzle/0001_wild_jigsaw.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../drizzle/0010_ashare_legacy_reconciliation.sql',import.meta.url),'utf8');
const statements=migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
// These are operation metadata, not market observations or success evidence.
const legacy={id:'single_upstream',status:'busy',lease_token:'5c3f28a0-6303-4432-8dab-019ff369586e',
 acquired_ms:1793856991992,finished_ms:1793842921309,updated_ms:1793856991992,not_before_ms:1793842924309,reason_code:null};
const make=(patch:Record<string,unknown>={})=>{
 const db=new DatabaseSync(':memory:');db.exec(schema);
 const row={...legacy,...patch};
 db.prepare('UPDATE ashare_source_gate SET status=?,lease_token=?,acquired_ms=?,finished_ms=?,updated_ms=?,not_before_ms=?,reason_code=?').run(
  row.status,row.lease_token,row.acquired_ms,row.finished_ms,row.updated_ms,row.not_before_ms,row.reason_code);
 return db;
};
const gate=(db:DatabaseSync)=>({...db.prepare('SELECT * FROM ashare_source_gate').get()});
const apply=(db:DatabaseSync)=>{for(const statement of statements)db.exec(statement);};
test('one-time reconciliation atomically preserves every old field and keeps unknown outcome explicit',()=>{
 const db=make();const before=gate(db);apply(db);const after=gate(db);
 assert.equal(after.status,'idle');assert.equal(after.lease_token,null);assert.equal(after.reason_code,null);
 assert.equal(after.acquired_ms,before.acquired_ms);assert.equal(Number(after.not_before_ms)-Number(after.finished_ms),60000);
 const audit=db.prepare('SELECT * FROM ashare_recovery_audit').get()!;
 for(const key of ['status','lease_token','acquired_ms','finished_ms','updated_ms','not_before_ms','reason_code'])assert.equal(audit[`prior_${key}`],before[key]);
 assert.equal(audit.invocation_outcome,'canceled_terminal');assert.equal(audit.source_outcome,'unknown');
 assert.equal(audit.reconciled_ms,after.updated_ms);
 assert.match(String(audit.evidence),/does not attest source success/);
 assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger'").get()?.n,0);
 apply(db);assert.deepEqual(gate(db),after);assert.equal(db.prepare('SELECT count(*) AS n FROM ashare_recovery_audit').get()?.n,1);db.close();
});
for(const [name,patch] of Object.entries({
 blocked:{status:'blocked',lease_token:null,reason_code:'http_403'},
 rate_limited:{status:'blocked',lease_token:null,reason_code:'http_429'},
 challenged:{status:'blocked',lease_token:null,reason_code:'challenge'},
 idle:{status:'idle',lease_token:null},
 different_owner:{lease_token:'another-current-acquisition'},
 changed_acquisition:{acquired_ms:1793856991993},
 changed_update:{updated_ms:1793856991993},
 changed_finished:{finished_ms:1793842921310},
 changed_cooldown:{not_before_ms:1793842924310},
 missing_acquisition:{acquired_ms:null},
}))test(`migration is a no-op for ${name}; never expires or clears another gate`,()=>{
 const db=make(patch);const before=gate(db);apply(db);assert.deepEqual(gate(db),before);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ashare_recovery_audit').get()?.n,0);db.close();
});
test('failed audit write rolls back the release rather than losing evidence',()=>{
 const db=make();db.exec(statements[0]);db.exec(statements[1]);
 db.exec("CREATE TRIGGER simulate_audit_failure BEFORE INSERT ON ashare_recovery_audit BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 const before=gate(db);assert.throws(()=>db.exec(statements[2]),/synthetic failure/);assert.deepEqual(gate(db),before);db.close();
});
test('interrupted application after audit/release does not execute reconciliation twice',()=>{
 const db=make();for(const statement of statements.slice(0,3))db.exec(statement);const after=gate(db);
 apply(db);assert.deepEqual(gate(db),after);assert.equal(db.prepare('SELECT count(*) AS n FROM ashare_recovery_audit').get()?.n,1);db.close();
});
test('new owner after reconciliation cannot be released by replayed migration',()=>{
 const db=make();apply(db);db.exec("UPDATE ashare_source_gate SET status='busy',lease_token='synthetic-new-owner',acquired_ms=1793868000000,updated_ms=1793868000000");
 const before=gate(db);apply(db);assert.deepEqual(gate(db),before);db.close();
});
