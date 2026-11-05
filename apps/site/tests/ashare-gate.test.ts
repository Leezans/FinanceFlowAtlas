import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1SourceGate, SQL, type GateD1, type D1Result } from '../lib/ashare/source-gate';

class FakeD1 implements GateD1 {
  now=1000; status='idle'; token: unknown=null; notBefore=0; reason: unknown=null;
  fail=false; afterAcquire?:()=>void;
  prepare(sql: string) { return { bind: (...v: unknown[]) => ({ run: async ():Promise<D1Result> => {
    if(this.fail) throw new Error('SECRET SQL ERROR token=private');
    let changes=0;
    if(sql===SQL.acquire) {
      if(this.status==='idle' && this.notBefore<=this.now) {
        this.status='busy'; this.token=v[0]; changes=1; this.afterAcquire?.();
      }
    } else if(sql===SQL.finish) {
      if(this.status==='busy' && this.token===v[3]) {
        this.status=v[0] as string; this.reason=v[1]; this.token=null; this.notBefore=this.now+Number(v[2]); changes=1;
      }
    } else if(sql===SQL.inspect) return {success:true,results:[{status:this.status,not_before_ms:this.notBefore,now_ms:this.now}],meta:{changes:0}};
    else throw new Error('Unknown SQL');
    return {success:true,results:[],meta:{changes}};
  }})}; }
}
const hasCode=(code: string)=>(err:unknown)=>typeof err==='object' && err!==null && 'code' in err && err.code===code;
test('simultaneous isolates and different scopes admit exactly one whole acquisition',async()=>{
  const db=new FakeD1();
  const result=await Promise.allSettled(Array.from({length:30},(_,i)=>new D1SourceGate(db).acquire(`scope-${i}`)));
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(db.status,'busy');
});
test('denial remains blocked after 15 minutes and fresh isolate, sanitizes reason',async()=>{
  const db=new FakeD1(); const g=new D1SourceGate(db); const l=await g.acquire('x');
  await g.release(l.token,{kind:'denied',reason:'https://private.example?secret=foo'});
  assert.equal(db.reason,'access_denied'); db.now+=15*60*1000;
  await assert.rejects(new D1SourceGate(db).acquire('different'),hasCode('source_denied'));
  await assert.rejects(g.release(l.token,{kind:'success'}),hasCode('source_stale_lease'));
  assert.equal(db.status,'blocked');
});
test('stale token cannot release current owner',async()=>{
  const db=new FakeD1(); const g=new D1SourceGate(db); const old=await g.acquire('x');
  await g.release(old.token,{kind:'success'}); db.now+=3000; const current=await g.acquire('x');
  await assert.rejects(g.release(old.token,{kind:'denied'}),hasCode('source_stale_lease'));
  assert.equal(db.status,'busy'); assert.equal(db.token,current.token);
});
test('crashed busy lease has no timeout or takeover even after years',async()=>{
  const db=new FakeD1(); await new D1SourceGate(db).acquire('x'); db.now+=10*365*86400000;
  await assert.rejects(new D1SourceGate(db).acquire('x'),hasCode('source_busy'));
});
test('successful acquisition keeps a full 3s quiet interval after finishing',async()=>{
  const db=new FakeD1(); const g=new D1SourceGate(db); const l=await g.acquire('x'); db.now+=60000;
  await g.release(l.token,{kind:'success'}); db.now+=2999;
  await assert.rejects(g.acquire('x'),hasCode('source_cooldown')); db.now++;
  await g.acquire('x');
});
test('temporary failure persists a 60s quiet interval across fresh isolates and scopes',async()=>{
  const db=new FakeD1(); const g=new D1SourceGate(db); const lease=await g.acquire('level1');
  db.now+=9000;
  await g.release(lease.token,{kind:'temporary_failure'});
  assert.equal(db.notBefore,db.now+60_000); assert.equal(db.status,'idle');
  db.now+=3000;
  await assert.rejects(new D1SourceGate(db).acquire('BK0001'),hasCode('source_cooldown'));
  db.now+=56_999;
  await assert.rejects(new D1SourceGate(db).acquire('level1'),hasCode('source_cooldown'));
  db.now++;
  await new D1SourceGate(db).acquire('BK0002');
});
test('unavailable DB fails closed without exposing DB error',async()=>{
  const db=new FakeD1(); db.fail=true;
  await assert.rejects(new D1SourceGate(db).acquire('x'),(e:Error)=>e.message==='source_gate_unavailable');
});
test('abort before acquisition avoids write; abort during DB acquisition awaits release',async()=>{
  const db=new FakeD1(); const controller=new AbortController(); controller.abort();
  await assert.rejects(new D1SourceGate(db).acquire('x',controller.signal),hasCode('source_aborted'));
  assert.equal(db.status,'idle'); const c=new AbortController(); db.afterAcquire=()=>c.abort();
  await assert.rejects(new D1SourceGate(db).acquire('x',c.signal),hasCode('source_aborted'));
  assert.equal(db.status,'idle'); assert.equal(db.notBefore,61000);
});
test('failed denied-state write leaves busy, never reopens gate',async()=>{
  const db=new FakeD1(); const g=new D1SourceGate(db); const l=await g.acquire('x'); db.fail=true;
  await assert.rejects(g.release(l.token,{kind:'denied',reason:'http_403'}),hasCode('source_gate_unavailable'));
  db.fail=false; db.now+=900000;
  await assert.rejects(new D1SourceGate(db).acquire('x'),hasCode('source_busy'));
});
test('actual SQLite syntax, CAS changes, constraints and permanent blocked row',async()=>{
  const db=new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../drizzle/0001_wild_jigsaw.sql',import.meta.url),'utf8'));
  const adapter:GateD1={prepare:(sql)=>({bind:(...v)=>({run:async()=>{
    const stmt=db.prepare(sql); const results=stmt.all(...v as SQLInputValue[]) as Record<string,unknown>[];
    const changed=db.prepare('SELECT changes() AS n').get() as {n:number};
    return {success:true,results,meta:{changes:sql.startsWith('UPDATE')?changed.n:0}};
  }})})};
  const g=new D1SourceGate(adapter); const l=await g.acquire('x');
  await assert.rejects(new D1SourceGate(adapter).acquire('y'),hasCode('source_busy'));
  await g.release(l.token,{kind:'success'});
  await assert.rejects(g.acquire('x'),hasCode('source_cooldown'));
  const successWindow=db.prepare('SELECT not_before_ms-finished_ms AS delay FROM ashare_source_gate').get();
  assert.equal(successWindow?.delay,3000);
  db.exec('UPDATE ashare_source_gate SET not_before_ms=0');
  const failed=await g.acquire('x'); await g.release(failed.token,{kind:'temporary_failure'});
  const failedWindow=db.prepare('SELECT not_before_ms-finished_ms AS delay FROM ashare_source_gate').get();
  assert.equal(failedWindow?.delay,60_000);
  await assert.rejects(new D1SourceGate(adapter).acquire('other'),hasCode('source_cooldown'));
  db.exec('UPDATE ashare_source_gate SET not_before_ms=0');
  const next=await g.acquire('x'); await g.release(next.token,{kind:'denied',reason:'http_429'});
  await assert.rejects(new D1SourceGate(adapter).acquire('x'),hasCode('source_denied'));
  assert.equal(db.prepare('SELECT reason_code FROM ashare_source_gate').get()?.reason_code,'http_429');
  assert.throws(()=>db.exec("INSERT INTO ashare_source_gate (id,status) VALUES ('second','idle')"));
  db.close();
});
