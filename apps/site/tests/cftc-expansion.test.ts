import {describe,expect,it,vi} from 'vitest';
import {parseCftc,CFTC_URL} from '../lib/futures/adapter';
import {CONTRACTS,FUTURES_CATEGORIES,MAX_SOURCE_BYTES,MAX_SOURCE_ROWS,MAX_SNAPSHOT_BYTES,REFRESH_MS,MAX_CACHE_AGE_MS,currentSnapshotSchema,legacySnapshotSchema,snapshotSchema,type CftcSnapshot,type CftcReply} from '../lib/futures/model';
import {D1CftcGate} from '../lib/futures/source-gate';
import {createCftcHandler,type CftcGate} from '../lib/futures/handler';
import {DIAGNOSTIC_QUERIES} from '../lib/diagnostics/queries';
import {fixture,reply,legacyReply,NOW,ISO} from './cftc-fixture';

const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
const request=()=>new Request('https://owner.invalid/api/v1/futures/cftc/snapshot');
const dbFor=(row:Record<string,unknown>)=>{const run=vi.fn(async()=>({success:true,results:[row]}));return {run,db:{prepare:()=>({bind:()=>({run})})}};};
describe('reviewed 52-market whitelist and atomic expansion',()=>{
 it('has exactly 52 unique identities in eight navigation groups and excludes consolidated series',()=>{
  expect(CONTRACTS).toHaveLength(52);expect(new Set(CONTRACTS.map(c=>c.code)).size).toBe(52);
  expect(FUTURES_CATEGORIES).toHaveLength(8);expect(CONTRACTS.every(c=>FUTURES_CATEGORIES.some(g=>g.id===c.category))).toBe(true);
  expect(CONTRACTS.some(c=>c.code.includes('+'))).toBe(false);
  expect(CONTRACTS.find(c=>c.code==='146021')?.units).toBe('(50 Index Points)');
  const where=new URL(CFTC_URL).searchParams.get('$where')!;
  expect(where.match(/'[^']+'/g)).toHaveLength(52);for(const c of CONTRACTS)expect(where).toContain(`'${c.code}'`);
  expect(new URL(CFTC_URL).searchParams.get('$limit')).toBe('208');
 });
 it.each(CONTRACTS.map(c=>c.code))('rejects missing period, identity/unit changes and unbalanced positions in market %s',code=>{
  const raw=fixture(),index=raw.findIndex(r=>r.cftc_contract_market_code===code);
  expect(()=>parseCftc(raw.filter((_,i)=>i!==index),ISO,ISO)).toThrow();
  for(const patch of [{market_and_exchange_names:'UNREVIEWED MARKET'},{contract_units:'USD'},{nonrept_positions_long_all:'201'},{nonrept_positions_short_all:'201'}]){
   const invalid=fixture();Object.assign(invalid[index],patch);expect(()=>parseCftc(invalid,ISO,ISO)).toThrow();
  }
 });
 it('rejects mismatched prior dates instead of silently filling a missing period from older history',()=>{
  const raw=fixture();raw[1].report_date_as_yyyy_mm_dd='2026-10-13T00:00:00.000';
  expect(()=>parseCftc(raw,ISO,ISO)).toThrow('invalid_snapshot');
  const valid=reply().snapshot!;valid.rows[0].previous.date='2026-10-13';expect(snapshotSchema.safeParse(valid).success).toBe(false);
 });
 it('accepts four complete periods above the old 64KiB source cap and selects only the actual latest two',()=>{
  const raw=fixture();for(const r of fixture())raw.push({...r,report_date_as_yyyy_mm_dd:r.report_date_as_yyyy_mm_dd.startsWith('2026-10-27')?'2026-10-13T00:00:00.000':'2026-10-06T00:00:00.000'});
  expect(raw).toHaveLength(MAX_SOURCE_ROWS);expect(bytes(raw)).toBeGreaterThan(65_536);expect(bytes(raw)).toBeLessThan(MAX_SOURCE_BYTES);
  const parsed=parseCftc(raw.reverse(),ISO,ISO);expect(parsed).toEqual(reply().snapshot);
 });
 it('proves the largest allowed counts fit the unchanged strict normalized-cache byte budget',()=>{
  const raw=fixture();for(const r of raw)Object.assign(r,{open_interest_all:'1000000000',noncomm_positions_long_all:'400000000',noncomm_positions_short_all:'300000000',noncomm_postions_spread_all:'100000000',comm_positions_long_all:'300000000',comm_positions_short_all:'400000000',nonrept_positions_long_all:'200000000',nonrept_positions_short_all:'200000000'});
  const parsed=parseCftc(raw,ISO,ISO);expect(parsed.rows).toHaveLength(52);expect(bytes(parsed)).toBeLessThan(MAX_SNAPSHOT_BYTES);
 });
 it('keeps original four-market cache identity and refuses relabeled/mixed/partial coverage',()=>{
  const old=legacyReply().snapshot!;expect(legacySnapshotSchema.safeParse(old).success).toBe(true);expect(currentSnapshotSchema.safeParse(old).success).toBe(false);
  expect(snapshotSchema.parse(old)).toEqual(old);
  expect(snapshotSchema.safeParse({...old,schema:'cftc-legacy-futures/2',coverage:'fifty_two_selected_us_cftc_futures_markets'}).success).toBe(false);
  expect(snapshotSchema.safeParse({...reply().snapshot,schema:'cftc-legacy-futures/1',coverage:'four_selected_us_cftc_futures_markets'}).success).toBe(false);
  const wrong={...old,rows:[...old.rows.slice(0,3),reply().snapshot!.rows.find(r=>r.code==='084691')!]};expect(snapshotSchema.safeParse(wrong).success).toBe(false);
 });
});
describe('schema-compatible shared gate with no reset or bypass',()=>{
 it.each(['legacy','current'])('reads the %s snapshot without changing timestamps or coordination',async version=>{
  const snapshot=(version==='legacy'?legacyReply():reply()).snapshot!,t=dbFor({status:'idle',not_before_ms:NOW+REFRESH_MS,payload:JSON.stringify(snapshot)});
  const result=await new D1CftcGate(t.db).inspect();expect(result).toEqual({state:'idle',retryAt:NOW+REFRESH_MS,snapshot});expect(t.run).toHaveBeenCalledTimes(1);
 });
 it('ignores even corrupt retained evidence when the gate is blocked',async()=>{
  const t=dbFor({status:'blocked',not_before_ms:NOW+REFRESH_MS,payload:'{invalid'});
  expect(await new D1CftcGate(t.db).inspect()).toEqual({state:'blocked',retryAt:NOW+REFRESH_MS,snapshot:null});expect(t.run).toHaveBeenCalledTimes(1);
 });
 it('does not write a legacy, partial or invalid result as a new successful acquisition',async()=>{
  for(const snapshot of [legacyReply().snapshot,{...reply().snapshot,rows:reply().snapshot!.rows.slice(0,51)}]){
   const t=dbFor({});await expect(new D1CftcGate(t.db).release('owned',{kind:'success',snapshot:snapshot as CftcSnapshot})).rejects.toMatchObject({code:'source_gate_unavailable'});expect(t.run).not.toHaveBeenCalled();
  }
 });
 it.each(['temporary','missing','unbalanced','wrong-units'])('retains only the exact valid legacy snapshot after %s expansion failure',async mode=>{
  const old=legacyReply().snapshot!,g:CftcGate={inspect:async()=>({state:'idle',retryAt:0,snapshot:old}),acquire:vi.fn(async()=>({token:'owned'})),release:vi.fn(async()=>{})};
  const raw=fixture();if(mode==='missing')raw.pop();if(mode==='unbalanced')raw[98].noncomm_positions_long_all='999';if(mode==='wrong-units')Object.assign(raw[98],{contract_units:'unreviewed'});
  const fetcher=vi.fn(async()=>Response.json(mode==='temporary'?{}:raw,{status:mode==='temporary'?503:200}));
  let time=NOW+REFRESH_MS;const h=createCftcHandler({gate:g,fetcher,now:()=>time,isolatedForTests:true});
  const result=await(await h(request())).json() as CftcReply;expect(result.snapshot).toEqual(old);expect(result.status.state).toBe('stale');expect(g.release).toHaveBeenCalledWith('owned',expect.objectContaining({kind:'temporary_failure'}));
  await h(request());expect(fetcher).toHaveBeenCalledTimes(1);
  time=NOW+MAX_CACHE_AGE_MS+1;g.inspect=async()=>({state:'idle',retryAt:time+REFRESH_MS,snapshot:old});expect((await(await h(request())).json() as CftcReply).snapshot).toBeNull();
 });
 it.each(['current','previous'])('rejects 207 otherwise valid rows missing the latest %s Ether period and retains v2 last-good',async period=>{
  const raw=fixture();for(const row of fixture())raw.push({...row,report_date_as_yyyy_mm_dd:row.report_date_as_yyyy_mm_dd.startsWith('2026-10-27')?'2026-10-13T00:00:00.000':'2026-10-06T00:00:00.000'});
  const absent=period==='current'?'2026-10-27':'2026-10-20';
  const incomplete=raw.filter(row=>!(row.cftc_contract_market_code==='146021'&&row.report_date_as_yyyy_mm_dd.startsWith(absent)));
  expect(incomplete).toHaveLength(207);expect(()=>parseCftc(incomplete,ISO,ISO)).toThrow('invalid_snapshot');
  const previous=reply().snapshot!;
  const gate:CftcGate={inspect:async()=>({state:'idle',retryAt:0,snapshot:previous}),acquire:vi.fn(async()=>({token:'owned'})),release:vi.fn(async()=>{})};
  const handler=createCftcHandler({gate,fetcher:async()=>Response.json(incomplete),now:()=>NOW+REFRESH_MS,isolatedForTests:true});
  const result=await(await handler(request())).json() as CftcReply;
  expect(result.snapshot).toEqual(previous);expect(result.status.state).toBe('stale');
  expect(gate.release).toHaveBeenCalledExactlyOnceWith('owned',expect.objectContaining({kind:'temporary_failure'}));
 });
 it('recognizes both cache versions in read-only diagnostic clock projection',()=>{
  const q=DIAGNOSTIC_QUERIES.find(q=>q.source==='cftc')!;expect(q.sql).toContain("IN ('cftc-legacy-futures/1','cftc-legacy-futures/2')");expect(q.sql).not.toContain("'$.rows'");
 });
});
