import {afterEach,expect,test} from 'vitest';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {D1KrakenGate} from '../lib/crypto/source-gate';
import type {D1Result} from '../lib/ashare/source-gate';
import type {SnapshotD1} from '../lib/ashare/snapshot-store';
import {parseTicker,universe} from './kraken-fixture';
import {MAX_CACHE_AGE_MS,REFRESH_MS} from '../lib/crypto/kraken';
import {readTradeSelection} from '../lib/crypto/selection';
import {parseKrakenTrades,tradeSnapshot} from '../lib/crypto/trades';

// All market values here are invented. This suite executes the production SQL
// against SQLite and never connects to Kraken or another network source.
const databases:DatabaseSync[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
function fixture(){
 const sqlite=new DatabaseSync(':memory:');databases.push(sqlite);
 const directory=new URL('../drizzle/',import.meta.url);
 const migration=readdirSync(directory).find(name=>name.startsWith('0017_')&&name.endsWith('.sql'))!;
 for(const name of ['0003_brainy_donald_blake.sql',migration])sqlite.exec(readFileSync(new URL(name,directory),'utf8'));
 let failAt=-1;
 const queries:string[]=[];
 const db:SnapshotD1={
  prepare(sql){return {bind(...values:unknown[]){return {async run():Promise<D1Result>{
   queries.push(sql);
   const results=sqlite.prepare(sql).all(...values as SQLInputValue[]) as Record<string,unknown>[];
   const changes=/^\s*(INSERT|UPDATE|DELETE)/.test(sql)?Number(sqlite.prepare('SELECT changes() n').get()!.n):0;
   return {success:true,results,meta:{changes}};
  }};}};},
  async batch(statements){
   sqlite.exec('BEGIN');
   try{const results=[];for(let i=0;i<statements.length;i++){if(i===failAt)throw new Error('private storage details');results.push(await statements[i].run());}sqlite.exec('COMMIT');return results;}
   catch(error){sqlite.exec('ROLLBACK');throw error;}
  },
 };
 return {sqlite,db,queries,gate:new D1KrakenGate(db),failAt:(index:number)=>{failAt=index;},elapse:()=>sqlite.exec('UPDATE kraken_source_gate SET not_before_ms=0')};
}
function evidence(offset=0){
 const started=Date.now()+offset-1000,finished=started+500,iso=new Date(started).toISOString();
 return parseTicker({error:[],result:{XXBTZUSD:{c:['12.34567890','1'],v:['999','3.12500000'],p:['999','12.10000000'],t:[999,8]},XETHZUSD:{c:['2.50000000','1'],v:['999','0.00000000'],p:['999','2.40000000'],t:[999,0]}}},iso,new Date(finished).toISOString());
}
function selection(pairs='BTC/USD',window='5m'){return readTradeSelection(new URL(`https://synthetic.invalid/?pairs=${pairs}&window=${window}`),true);}
function trades(snapshot:ReturnType<typeof evidence>,pairs='BTC/USD',window:'1m'|'5m'='5m'){
 const started=Date.parse(snapshot.acquisition_started_at),finished=Date.parse(snapshot.fetched_at);
 const rows=universe(snapshot.catalog_fetched_at).pairs.filter(pair=>pairs.split(',').includes(pair.pair)).map(pair=>
  parseKrakenTrades({error:[],result:{[pair.source_pair]:[['10.5','2',(started-5000)/1000,'b','m','',1]],last:String(BigInt(started)*BigInt(1000000))}},pair,started-(window==='1m'?60_000:300_000),started,finished));
 return tradeSnapshot(rows,started,finished,pairs.split(','),window);
}

// Store-specific tests are below; the adapter intentionally models D1 batch's
// transaction rollback, not a permissive mock returning canned SQL results.
import {D1KrakenSnapshotStore} from '../lib/crypto/snapshot-store';
function bundle(pairs:string|null='BTC/USD',window:'1m'|'5m'='5m',offset=0){
 const snapshot=evidence(offset);
 return {snapshot,universe:universe(snapshot.catalog_fetched_at),trades:pairs?trades(snapshot,pairs,window):null,key:pairs?selection(pairs,window).key:null};
}
async function publish(f:ReturnType<typeof fixture>,value=bundle()){
 f.elapse();const lease=await f.gate.acquire();await new D1KrakenSnapshotStore(f.db).commit(lease.token,value);return lease;
}
function state(f:ReturnType<typeof fixture>){return {snapshots:f.sqlite.prepare('SELECT * FROM kraken_snapshot_cache ORDER BY snapshot_id').all(),refs:f.sqlite.prepare('SELECT * FROM kraken_snapshot_refs ORDER BY cache_key').all(),gate:f.sqlite.prepare('SELECT * FROM kraken_source_gate').all()};}

test('atomic publication releases the exact lease and a cold reader preserves all provenance',async()=>{
 const f=fixture(),value=bundle();await publish(f,value);
 const result=await new D1KrakenSnapshotStore(f.db).read(selection());
 expect(result.bundle).toEqual(value);expect(result.ageMs).toBeGreaterThanOrEqual(500);
 expect(f.sqlite.prepare('SELECT status,lease_token,not_before_ms-updated_ms quiet FROM kraken_source_gate').get()).toEqual({status:'idle',lease_token:null,quiet:REFRESH_MS});
 expect(result.bundle?.snapshot.source_observed_at).toBeNull();
 expect(result.bundle?.snapshot.fetched_at).toBe(value.snapshot.fetched_at);
 expect(result.bundle?.trades?.window_ended_at).toBe(value.trades?.window_ended_at);
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM kraken_snapshot_cache').get()!.n).toBe(1);
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM kraken_snapshot_refs').get()!.n).toBe(2);
});
test('selection and time-window identities remain separate and quote-only fallback retains its own identity',async()=>{
 const f=fixture(),five=bundle('BTC/USD','5m'),one=bundle('BTC/USD','1m'),eth=bundle('ETH/USD','5m');
 for(const value of [five,one,eth])await publish(f,value);
 const store=new D1KrakenSnapshotStore(f.db);
 expect((await store.read(selection('BTC/USD','5m'))).bundle).toEqual(five);
 expect((await store.read(selection('BTC/USD','1m'))).bundle).toEqual(one);
 expect((await store.read(selection('ETH/USD','5m'))).bundle).toEqual(eth);
 expect((await store.read(selection('SOL/USD','1m'))).bundle).toEqual(eth);
 const quote=bundle(null);await publish(f,quote);
 expect((await store.read(selection('SOL/USD','1m'))).bundle).toEqual(quote);
 expect((await store.read(selection('BTC/USD','5m'))).bundle).toEqual(five);
});
test('busy and denied states suppress durable evidence without touching cache or gate',async()=>{
 const f=fixture();await publish(f);f.elapse();const lease=await f.gate.acquire();
 const before=state(f);const busy=await new D1KrakenSnapshotStore(f.db).read(selection());
 expect(busy).toMatchObject({code:'source_busy',canAcquire:false});expect(busy.bundle).toBeUndefined();expect(state(f)).toEqual(before);
 await f.gate.release(lease.token,{kind:'denied'});const blocked=state(f);
 const denied=await new D1KrakenSnapshotStore(f.db).read(selection());
 expect(denied).toMatchObject({code:'source_denied',canAcquire:false});expect(denied.bundle).toBeUndefined();expect(state(f)).toEqual(blocked);
});
test('stale owner cannot publish, alter retention, or release a newer lease',async()=>{
 const f=fixture(),old=await publish(f);f.elapse();await f.gate.acquire();const before=state(f);
 await expect(new D1KrakenSnapshotStore(f.db).commit(old.token,bundle('ETH/USD'))).rejects.toMatchObject({code:'source_stale_lease'});
 expect(state(f)).toEqual(before);
});
test.each([0,1,2,3,4,5,6])('selected batch failure at statement %s rolls back cache, refs and release',async index=>{
 const f=fixture();await publish(f);f.elapse();const lease=await f.gate.acquire(),before=state(f);f.failAt(index);
 await expect(new D1KrakenSnapshotStore(f.db).commit(lease.token,bundle('ETH/USD'))).rejects.toMatchObject({code:'source_gate_unavailable'});
 expect(state(f)).toEqual(before);expect((await new D1KrakenSnapshotStore(f.db).read(selection())).bundle).toBeUndefined();
});
test.each([0,1,2,3,4,5])('quote-only batch failure at statement %s also retains the owner',async index=>{
 const f=fixture();await publish(f);f.elapse();const lease=await f.gate.acquire(),before=state(f);f.failAt(index);
 await expect(new D1KrakenSnapshotStore(f.db).commit(lease.token,bundle(null))).rejects.toMatchObject({code:'source_gate_unavailable'});expect(state(f)).toEqual(before);
});
test('cache retention is bounded and replacing one selection does not append an archive',async()=>{
 const f=fixture();
 for(let i=0;i<20;i++)await publish(f,bundle(`SYNTH${i}/USD`));
 expect(Number(f.sqlite.prepare('SELECT COUNT(*) n FROM kraken_snapshot_refs').get()!.n)).toBeLessThanOrEqual(17);
 expect(Number(f.sqlite.prepare('SELECT COUNT(*) n FROM kraken_snapshot_cache').get()!.n)).toBeLessThanOrEqual(17);
 for(let i=0;i<5;i++)await publish(f,bundle('SYNTH19/USD'));
 expect(Number(f.sqlite.prepare('SELECT COUNT(*) n FROM kraken_snapshot_cache').get()!.n)).toBeLessThanOrEqual(17);
 expect(f.sqlite.prepare("SELECT COUNT(*) n FROM kraken_snapshot_refs WHERE cache_key='5m:SYNTH19/USD'").get()!.n).toBe(1);
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM kraken_snapshot_refs r LEFT JOIN kraken_snapshot_cache s USING(snapshot_id) WHERE s.snapshot_id IS NULL').get()!.n).toBe(0);
});
test('original fetched time cannot be renewed by publishing now',async()=>{
 const f=fixture(),value=bundle('BTC/USD','5m',-65_000);await publish(f,value);
 const read=await new D1KrakenSnapshotStore(f.db).read(selection());expect(read.ageMs).toBeGreaterThanOrEqual(65_500);
 expect(read.bundle).toEqual(value);
});
test('expired evidence is never served and a successful publication prunes expired refs and rows',async()=>{
 const f=fixture();await publish(f);
 f.sqlite.prepare('UPDATE kraken_snapshot_cache SET fetched_ms=fetched_ms-?,expires_ms=expires_ms-?').run(MAX_CACHE_AGE_MS+1,MAX_CACHE_AGE_MS+1);
 expect((await new D1KrakenSnapshotStore(f.db).read(selection())).bundle).toBeUndefined();
 await publish(f,bundle('ETH/USD'));expect(f.sqlite.prepare('SELECT COUNT(*) n FROM kraken_snapshot_cache').get()!.n).toBe(1);
});
test.each(['numeric','duplicate','clock','key','window','universe','format','invalid_json','duplicate_key'])('corrupt persisted %s evidence is rejected without repair',async kind=>{
 const f=fixture(),value=bundle();await publish(f,value);const broken=structuredClone(value);
 if(kind==='numeric')broken.snapshot.rows[0].last_price_usd=123 as unknown as string;
 if(kind==='duplicate')broken.snapshot.rows.push(broken.snapshot.rows[0]);
 if(kind==='clock')broken.snapshot.fetched_at='2026-99-99T00:00:00.000Z';
 if(kind==='key')broken.key='1m:BTC/USD';
 if(kind==='window')broken.trades!.window_ms=60_000;
 if(kind==='universe')broken.universe.pairs[0].pair='OTHER/USD';
 if(kind==='invalid_json')f.sqlite.exec('PRAGMA ignore_check_constraints=ON');
 if(kind==='format'){f.sqlite.exec('PRAGMA ignore_check_constraints=ON');f.sqlite.exec('UPDATE kraken_snapshot_cache SET format_version=2');}
 else f.sqlite.prepare('UPDATE kraken_snapshot_cache SET payload=?').run(kind==='invalid_json'?'{':kind==='duplicate_key'?JSON.stringify(broken).replace('"key":','"key":null,"key":'):JSON.stringify(broken));
 const before=state(f),read=await new D1KrakenSnapshotStore(f.db).read(selection());
 expect(read).toMatchObject({code:'snapshot_invalid',canAcquire:false});expect(read.bundle).toBeUndefined();expect(state(f)).toEqual(before);
});
test('missing cache migration or gate fails closed without leaking private SQL exceptions',async()=>{
 const f=fixture();f.sqlite.exec('DROP TABLE kraken_snapshot_refs');
 expect(await new D1KrakenSnapshotStore(f.db).read(selection())).toMatchObject({code:'snapshot_store_unavailable',canAcquire:false});
 const other=fixture();other.sqlite.exec('DELETE FROM kraken_source_gate');
 const result=await new D1KrakenSnapshotStore(other.db).read(selection());expect(result.canAcquire).toBe(false);expect(result.bundle).toBeUndefined();
});
test('migration creates cache tables without resetting admission, denial, or lease history',()=>{
 const sql=readFileSync(new URL('../drizzle/0017_kraken_shared_snapshots.sql',import.meta.url),'utf8');
 expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|DROP|ALTER|INSERT)\s+(?:INTO\s+)?[`"]?kraken_source_gate\b/i);
 expect(sql).toContain('kraken_snapshot_cache');expect(sql).toContain('kraken_snapshot_refs');
});
test.each([120_000,-MAX_CACHE_AGE_MS-2000])('publication with fetched offset %s rolls back rather than rejuvenating evidence',async offset=>{
 const f=fixture();await publish(f);f.elapse();const lease=await f.gate.acquire(),before=state(f);
 await expect(new D1KrakenSnapshotStore(f.db).commit(lease.token,bundle('BTC/USD','5m',offset))).rejects.toMatchObject({code:'source_gate_unavailable'});
 expect(state(f)).toEqual(before);
});
test('a read uses one joined permission-and-evidence query and no write',async()=>{
 const f=fixture();await publish(f);f.queries.length=0;
 expect((await new D1KrakenSnapshotStore(f.db).read(selection())).bundle).toBeDefined();
 expect(f.queries).toHaveLength(1);expect(f.queries[0]).toMatch(/^SELECT/);expect(f.queries[0]).toContain('kraken_source_gate');expect(f.queries[0]).toContain('kraken_snapshot_cache');
});
test('mismatched canonical selection key fails before reading storage',async()=>{
 const f=fixture();const malformed={...selection(),key:'1m:BTC/USD'};
 expect(await new D1KrakenSnapshotStore(f.db).read(malformed)).toEqual({code:'snapshot_invalid',canAcquire:false});expect(f.queries).toHaveLength(0);
});
test('a failed D1 result cannot expose cache or claim publication was confirmed',async()=>{
 const f=fixture();await publish(f);const unavailable:SnapshotD1={prepare(){return {bind(){return {async run(){return {success:false,results:[],meta:{changes:0}};}};}};},batch:async()=>[]};
 expect(await new D1KrakenSnapshotStore(unavailable).read(selection())).toEqual({code:'snapshot_store_unavailable',canAcquire:false});
 await expect(new D1KrakenSnapshotStore(unavailable).commit('synthetic',bundle())).rejects.toMatchObject({code:'source_gate_unavailable'});
});

test('oversized persisted payload is rejected at the decoder boundary',async()=>{
 const f=fixture();await publish(f);f.sqlite.exec('PRAGMA ignore_check_constraints=ON');
 f.sqlite.prepare('UPDATE kraken_snapshot_cache SET payload=?').run(' '.repeat(2_000_001));
 const read=await new D1KrakenSnapshotStore(f.db).read(selection());expect(read).toMatchObject({code:'snapshot_invalid',canAcquire:false});expect(read.bundle).toBeUndefined();
});
