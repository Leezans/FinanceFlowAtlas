import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {combineSnapshots,serializeCombinedSnapshot} from '../lib/options/adapter';
import {createOptionsHandler} from '../lib/options/handler';
import {DERIBIT_SQL,D1OptionsGate} from '../lib/options/source-gate';
import {MAX_BYTES,MAX_CACHE_BYTES,MAX_ROWS,REFRESH_MS,snapshotSchema,type OptionsReply,type OptionsSnapshot} from '../lib/options/model';
import type {D1Result,GateD1} from '../lib/ashare/source-gate';
import {at,combinedOptionsReply,optionsReply} from './deribit-fixture';

// Fault injection only: no production handler seam. Oversize tests below use
// the real combiner and full source adapters, not an injected candidate.
vi.mock('../lib/options/adapter',async importOriginal=>{
 const actual=await importOriginal<typeof import('../lib/options/adapter')>();
 return {...actual,combineSnapshots:vi.fn(actual.combineSnapshots)};
});
const actual=await vi.importActual<typeof import('../lib/options/adapter')>('../lib/options/adapter');
beforeEach(()=>{vi.mocked(combineSnapshots).mockImplementation(actual.combineSnapshots);});
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
const request=()=>new Request('https://app.invalid/api/v1/options/deribit/snapshot');
const refreshAt=at+REFRESH_MS;
type StoredRow={status:'idle'|'busy'|'blocked';not_before_ms:number;payload:string|null;lease_token:string|null};
function sharedGate(payload:string|null){
 const row:StoredRow={status:'idle',not_before_ms:0,payload,lease_token:null};
 const control:{finish?: (apply:()=>D1Result)=>Promise<D1Result>}={};
 const run=vi.fn(async(sql:string,values:unknown[]):Promise<D1Result>=>{
  if(sql===DERIBIT_SQL.inspect)return {success:true,results:[{...row,now_ms:refreshAt}]};
  if(sql===DERIBIT_SQL.acquire){
   const changes=row.status==='idle'&&row.not_before_ms<=refreshAt?1:0;
   if(changes){row.status='busy';row.lease_token=values[0] as string;}
   return {success:true,meta:{changes}};
  }
  if(sql!==DERIBIT_SQL.finish)throw new Error('Unexpected synthetic SQL');
  const apply=():D1Result=>{
   const [status,delay,purge,next,token]=values;
   const changes=row.status==='busy'&&row.lease_token===token?1:0;
   if(changes){row.status=status as StoredRow['status'];row.lease_token=null;row.not_before_ms=refreshAt+(delay as number);row.payload=purge?null:(next as string|null)??row.payload;}
   return {success:true,meta:{changes}};
  };
  return control.finish?control.finish(apply):apply();
 });
 const db:GateD1={prepare:sql=>({bind:(...values)=>({run:()=>run(sql,values)})})};
 const gate=new D1OptionsGate(db),release=vi.spyOn(gate,'release');
 return {row,gate,release,run,control,finishes:()=>run.mock.calls.filter(([sql])=>sql===DERIBIT_SQL.finish)};
}
function legacyPayload(){
 const s=optionsReply().snapshot!;
 return JSON.stringify({schema:'deribit-btc-options/1',source:s.source,currency:'BTC',coverage:s.coverage,
  acquisition_started_at:s.acquisition_started_at,fetched_at:s.fetched_at,source_as_of:s.source_as_of,
  metadata_fetched_at:s.metadata_fetched_at.BTC,net_capital_flow:null,delay_policy:s.delay_policy,
  rows:s.rows.map(row=>{const copy:Partial<typeof row>={...row};delete copy.underlying_currency;return copy;})});
}
function sourceFetcher(oversized=false){
 const snapshot=combinedOptionsReply().snapshot!;
 const responses=new Map<string,string>();
 for(const currency of ['BTC','ETH'] as const){
  const template=snapshot.rows.find(row=>row.underlying_currency===currency)!;
  const rows=oversized?Array.from({length:MAX_ROWS},(_,i)=>({...template,
   instrument:`${currency}-27NOV26-${'0'.repeat(450)}${80000+i}-C`,strike:80000+i,
  })):snapshot.rows.filter(row=>row.underlying_currency===currency);
  const summary=rows.map(row=>({instrument_name:row.instrument,base_currency:currency,quote_currency:currency,
   creation_timestamp:refreshAt,mark_price:row.mark_price,mark_iv:row.mark_iv,price_change:row.price_change,
   bid_price:row.bid_price,ask_price:row.ask_price,last:row.last,volume:row.volume,volume_usd:row.volume_usd,open_interest:row.open_interest}));
  const metadata=rows.map(row=>({instrument_name:row.instrument,kind:'option',is_active:true,
   base_currency:currency,quote_currency:currency,settlement_currency:currency,counter_currency:'USD',
   expiration_timestamp:row.expiration_timestamp,strike:row.strike,option_type:row.option_type,contract_size:row.contract_size}));
  for(const [endpoint,result] of [['get_book_summary_by_currency',summary],['get_instruments',metadata]] as const){
   expect(result.length).toBeLessThanOrEqual(MAX_ROWS);
   const body=JSON.stringify({jsonrpc:'2.0',testnet:false,result});
   expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(MAX_BYTES);
   responses.set(`${endpoint}:${currency}`,body);
  }
 }
 const fetcher=vi.fn<typeof fetch>(async input=>{
  const url=new URL(String(input)),body=responses.get(`${url.pathname.split('/').at(-1)}:${url.searchParams.get('currency')}`);
  if(!body)throw new Error('Unexpected synthetic source URL');
  return new Response(body,{headers:{'content-type':'application/json','content-length':String(body.length)}});
 });
 return {fetcher,responses};
}
const storedCases=[['combined',()=>JSON.stringify(combinedOptionsReply().snapshot)],['legacy BTC',legacyPayload],['empty',()=>null]] as const;

describe('Deribit commit preflight and owned cleanup',()=>{
 it('accepts exactly 3 MB of validated serialized data and rejects one more byte',()=>{
  const candidate=combinedOptionsReply().snapshot!,base=serializeCombinedSnapshot(candidate);
  candidate.rows[0].instrument=`BTC-27NOV26-${'0'.repeat(MAX_CACHE_BYTES-base.length)}80000-C`;
  const bounded=serializeCombinedSnapshot(candidate);
  expect(new TextEncoder().encode(bounded).byteLength).toBe(MAX_CACHE_BYTES);
  candidate.rows[0].instrument=candidate.rows[0].instrument.replace('80000-C','080000-C');
  expect(()=>serializeCombinedSnapshot(candidate)).toThrowError('byte_budget');
 });

 it.each(storedCases)('rejects an oversized normalized snapshot before commit and preserves %s storage',async(_label,stored)=>{
  const payload=stored(),t=sharedGate(payload),{fetcher}=sourceFetcher(true);
  const handler=createOptionsHandler({gate:t.gate,fetcher,now:()=>refreshAt,isolatedForTests:true});
  const response=await handler(request()),reply=await response.json() as OptionsReply;
  const candidate=vi.mocked(combineSnapshots).mock.results[0].value as OptionsSnapshot;
  expect(snapshotSchema.safeParse(candidate).success).toBe(true);
  expect(candidate.rows).toHaveLength(2*MAX_ROWS);
  expect(JSON.stringify(candidate).length).toBeGreaterThan(MAX_CACHE_BYTES);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(t.row).toEqual({status:'idle',lease_token:null,not_before_ms:refreshAt+REFRESH_MS,payload});
  expect(t.release).toHaveBeenCalledExactlyOnceWith(expect.any(String),{kind:'temporary_failure',retryAfterMs:REFRESH_MS});
  expect(t.finishes()).toHaveLength(1);
  expect(t.finishes()[0][1].slice(0,4)).toEqual(['idle',REFRESH_MS,0,null]);
  expect(reply.status.error_code).toBe('byte_budget');
  expect(reply.status.state).toBe(payload?'stale':'unavailable');
  expect(reply.snapshot).toEqual(payload?snapshotSchema.parse(JSON.parse(payload)):null);
  expect(response.status).toBe(payload?200:503);
  expect(reply.status.next_retry_at).toBe(new Date(refreshAt+REFRESH_MS).toISOString());
  // A cold worker also honors the durable cooldown and the exact original cache.
  const cold=createOptionsHandler({gate:t.gate,fetcher,now:()=>refreshAt,isolatedForTests:true});
  const coldReply=await(await cold(request())).json() as OptionsReply;
  expect(coldReply.snapshot).toEqual(reply.snapshot);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(t.finishes()).toHaveLength(1);
 });

 it.each(['invalid schema','incomplete coverage'] as const)('cleans an owned lease after a defensive %s fault without hiding the last-good cache',async kind=>{
  const payload=JSON.stringify(combinedOptionsReply().snapshot),t=sharedGate(payload),{fetcher}=sourceFetcher();
  const candidate=kind==='invalid schema'?combinedOptionsReply().snapshot!:optionsReply().snapshot!;
  if(kind==='invalid schema')candidate.rows[0].volume=-1;
  vi.mocked(combineSnapshots).mockReturnValue(candidate);
  const handler=createOptionsHandler({gate:t.gate,fetcher,now:()=>refreshAt,isolatedForTests:true});
  const reply=await(await handler(request())).json() as OptionsReply;
  expect(reply.status.state).toBe('stale');
  expect(reply.status.error_code).toBe(kind==='invalid schema'?'invalid_snapshot':'incomplete_option_coverage');
  expect(reply.snapshot).toEqual(JSON.parse(payload));
  expect(t.row).toEqual({status:'idle',lease_token:null,not_before_ms:refreshAt+REFRESH_MS,payload});
  expect(t.release).toHaveBeenCalledExactlyOnceWith(expect.any(String),{kind:'temporary_failure',retryAfterMs:REFRESH_MS});
  expect(t.finishes()).toHaveLength(1);
 });

 it.each(['invalid schema','incomplete coverage','oversized'] as const)('keeps independent D1 protection against %s writes',async kind=>{
  const payload=JSON.stringify(combinedOptionsReply().snapshot),t=sharedGate(payload);
  let candidate=kind==='incomplete coverage'?optionsReply().snapshot!:combinedOptionsReply().snapshot!;
  if(kind==='invalid schema')candidate.rows[0].volume=-1;
  if(kind==='oversized'){
   const {fetcher}=sourceFetcher(true);
   const handler=createOptionsHandler({gate:t.gate,fetcher,now:()=>refreshAt,isolatedForTests:true});
   await handler(request());candidate=vi.mocked(combineSnapshots).mock.results[0].value as OptionsSnapshot;
   t.run.mockClear();t.release.mockClear();
  }
  const before={...t.row};
  await expect(t.gate.release('owned',{kind:'success',snapshot:candidate})).rejects.toMatchObject({code:'source_gate_unavailable'});
  expect(t.run).not.toHaveBeenCalled();expect(t.row).toEqual(before);
 });
});

describe('Deribit actual D1 release uncertainty remains fail-closed',()=>{
 it('suppresses old evidence if preflight cleanup itself has an unknown D1 outcome',async()=>{
  const payload=JSON.stringify(combinedOptionsReply().snapshot),t=sharedGate(payload),{fetcher}=sourceFetcher();
  vi.mocked(combineSnapshots).mockReturnValue(optionsReply().snapshot!);
  t.control.finish=async()=>{throw new Error('Synthetic cleanup failure');};
  const handler=createOptionsHandler({gate:t.gate,fetcher,now:()=>refreshAt,isolatedForTests:true});
  const reply=await(await handler(request())).json() as OptionsReply;
  expect(reply.status.error_code).toBe('source_gate_outcome_unconfirmed');expect(reply.status.state).toBe('denied');
  expect(reply.snapshot).toBeNull();expect(t.row.status).toBe('busy');expect(t.row.payload).toBe(payload);
  expect(t.release).toHaveBeenCalledExactlyOnceWith(expect.any(String),{kind:'temporary_failure',retryAfterMs:REFRESH_MS});
  await handler(request());expect(t.finishes()).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });

 it.each(['throw before commit','commit then lose acknowledgment','missing changes','stale lease'] as const)('never cleans or retries a %s outcome',async mode=>{
  const payload=JSON.stringify(combinedOptionsReply().snapshot),t=sharedGate(payload),{fetcher}=sourceFetcher();
  t.control.finish=async apply=>{
   if(mode==='commit then lose acknowledgment')apply();
   if(mode==='missing changes')return {success:true};
   if(mode==='stale lease')return {success:true,meta:{changes:0}};
   throw new Error('Synthetic D1 failure');
  };
  const handler=createOptionsHandler({gate:t.gate,fetcher,now:()=>refreshAt,isolatedForTests:true});
  const reply=await(await handler(request())).json() as OptionsReply;
  expect(reply.snapshot).toBeNull();expect(reply.status.state).toBe('denied');
  expect(reply.status.error_code).toBe('source_gate_outcome_unconfirmed');
  expect(t.release).toHaveBeenCalledTimes(1);expect(t.release.mock.calls[0][1].kind).toBe('success');
  expect(t.finishes()).toHaveLength(1);
  if(mode==='commit then lose acknowledgment')expect(t.row.status).toBe('idle');
  else{expect(t.row.status).toBe('busy');expect(t.row.payload).toBe(payload);}
  await handler(request());expect(t.finishes()).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });

 it.each(['success','failure'] as const)('retains late D1 %s settlement without retry or cleanup after the deadline',async outcome=>{
  vi.useFakeTimers();
  const payload=JSON.stringify(combinedOptionsReply().snapshot),t=sharedGate(payload),{fetcher}=sourceFetcher();
  let settle:()=>void=()=>{},retained:Promise<unknown>|undefined;
  t.control.finish=apply=>new Promise((resolve,reject)=>{settle=()=>outcome==='success'?resolve(apply()):reject(new Error('Late synthetic failure'));});
  const handler=createOptionsHandler({gate:t.gate,fetcher,now:()=>refreshAt,waitUntil:p=>{retained=p;}});
  const pending=handler(request());
  await vi.waitFor(()=>expect(t.finishes()).toHaveLength(1));
  let done=false;void retained!.then(()=>{done=true;});
  await vi.advanceTimersByTimeAsync(15_000);
  const reply=await(await pending).json() as OptionsReply;
  expect(reply.status.error_code).toBe('source_gate_outcome_unconfirmed');expect(reply.snapshot).toBeNull();
  expect(done).toBe(false);expect(t.row.status).toBe('busy');expect(t.row.payload).toBe(payload);
  expect(t.release).toHaveBeenCalledTimes(1);expect(t.finishes()).toHaveLength(1);
  settle();await retained;expect(done).toBe(true);
  expect(t.row.status).toBe(outcome==='success'?'idle':'busy');
  expect(t.release).toHaveBeenCalledTimes(1);expect(t.finishes()).toHaveLength(1);
  const repeated=await(await handler(request())).json() as OptionsReply;
  expect(repeated.snapshot).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
 });
});
