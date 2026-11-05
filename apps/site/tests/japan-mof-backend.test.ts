import {describe,it,expect,vi} from 'vitest';
import {parseJapanMof,parseCSV,parsePeriod} from '../lib/japan/adapter';
import {snapshotSchema,REFRESH_MS,visibleSnapshot,replySchema} from '../lib/japan/model';
import {readCp932CSV} from '../lib/reports/json';
import {createJapanMofHandler} from '../lib/japan/runtime';
import type {ReportGate,ReportOutcome} from '../lib/reports/types';
import type {JapanMofSnapshot} from '../lib/japan/model';
import {csv,mofFixture} from './japan-mof-fixture';
const START='2026-10-30T00:00:00.000Z';
const parse=(text=csv())=>parseJapanMof(text,START,START);
class Gate implements ReportGate<JapanMofSnapshot>{state:'idle'|'busy'|'blocked'='idle';snapshot:JapanMofSnapshot|null=null;retryAt=0;async inspect(){return {state:this.state,snapshot:this.snapshot,retryAt:this.retryAt};}async acquire(){this.state='busy';return {token:'test'};}async release(_token:string,o:ReportOutcome<JapanMofSnapshot>){this.state=o.kind==='denied'?'blocked':'idle';this.retryAt=Date.parse(START)+REFRESH_MS;if(o.snapshot)this.snapshot=o.snapshot;if(this.state==='blocked')this.snapshot=null;}}
describe('MOF weekly parser',()=>{
 it('preserves three nonoverlapping categories and separate official total',()=>{const s=parse();expect(s.assets.map(a=>a.net)).toEqual([60,-25,-10]);expect(s.total_net).toBe(25);expect(s.report_end).toBe('2026-10-24');expect(s.updated_date).toBe('2026-10-29');expect(s.source_released_at).toBeNull();});
 it('accepts integer rounding without rewriting official nets',()=>{const r=mofFixture();r[14][14]='61';expect(parse(csv(r)).assets[0].net).toBe(61);r[14][14]='62';expect(()=>parse(csv(r))).toThrow();});
 it('parses crossing year and fullwidth dates',()=>{expect(parsePeriod('2023．12．31～ 2024．1．6')).toEqual({start:'2023-12-31',end:'2024-01-06'});expect(()=>parsePeriod('2026.2.30~3.8')).toThrow();});
 it('handles embedded newlines and quotes and rejects malformed CSV',()=>{const r=mofFixture();r[0][0]='a\nb"c';expect(parseCSV(csv(r))[0][0]).toBe('a\nb"c');expect(()=>parseCSV('"bad')).toThrow();expect(()=>parseCSV('a,b')).toThrow();});
 it.each(['1e3','NaN','1.5','1,00','90071993','-1'])('rejects malformed/negative/unbounded acquisition %s',n=>{const r=mofFixture();r[14][12]=n;expect(()=>parse(csv(r))).toThrow();});
 it('rejects changed units, swapped headers, future update and total mismatch',()=>{for(const [i,j,value] of [[4,19,'Unit: Yen'],[13,12,'Disposition'],[1,19,'Final Update November 1 , 2026'],[14,22,'999']] as const){const r=mofFixture();r[i][j]=value;expect(()=>parse(csv(r))).toThrow();}});
 it('rejects duplicate observations and missing notes',()=>{const r=mofFixture();r.splice(15,0,r[14]);expect(()=>parse(csv(r))).toThrow('period_gap');expect(()=>parse(csv(mofFixture().slice(0,16)))).toThrow('invalid_notes');});
 it('rejects cache corruption and expires by observation age',()=>{const s=parse();expect(snapshotSchema.safeParse({...s,assets:[s.assets[0],s.assets[0],s.assets[2]]}).success).toBe(false);});
});
describe('MOF bounded source and shared report handler',()=>{
 it('decodes CP932, rejects HTML, bytes and malformed encoding',async()=>{expect(await readCp932CSV(new Response(new Uint8Array([0x93,0xfa,0x96,0x7b]),{headers:{'content-type':'text/csv'}}),new AbortController().signal,20)).toBe('日本');for(const response of [new Response('<html>',{headers:{'content-type':'text/csv'}}),new Response('long',{headers:{'content-type':'text/csv','content-length':'30'}}),new Response(new Uint8Array([0x81]),{headers:{'content-type':'text/csv'}})])await expect(readCp932CSV(response,new AbortController().signal,20)).rejects.toThrow();});
 it('uses fixed source and caches across cold handlers, status never fetches',async()=>{const gate=new Gate(),fetcher=vi.fn(async()=>new Response(csv(),{headers:{'content-type':'text/csv'}}));const options={gate,fetcher:fetcher as typeof fetch,now:()=>Date.parse(START),isolatedForTests:true};const warm=createJapanMofHandler(options),cold=createJapanMofHandler(options);await warm(new Request('https://local/status'));expect(fetcher).not.toHaveBeenCalled();const r=replySchema.parse(await (await warm(new Request('https://local/snapshot'))).json());expect(r.status.state).toBe('available');expect(visibleSnapshot(r,Date.parse(START))).not.toBeNull();await cold(new Request('https://local/snapshot'));expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]).toBeDefined();});
 it.each([302,403,429])('persists permanent denial for HTTP %s',async status=>{const gate=new Gate(),fetcher=vi.fn(async()=>new Response(null,{status}));const options={gate,fetcher:fetcher as typeof fetch,now:()=>Date.parse(START),isolatedForTests:true};for(let i=0;i<2;i++){const r=replySchema.parse(await (await createJapanMofHandler(options)(new Request('https://local/snapshot'))).json());expect(r.snapshot).toBeNull();expect(r.status.state).toBe('denied');}expect(fetcher).toHaveBeenCalledTimes(1);});
 it('retains last good with stale status on temporary failure',async()=>{let now=Date.parse(START);const gate=new Gate(),fetcher=vi.fn(async()=>new Response(csv(),{headers:{'content-type':'text/csv'}}));const h=createJapanMofHandler({gate,fetcher:fetcher as typeof fetch,now:()=>now,isolatedForTests:true});await h(new Request('https://local/snapshot'));now+=REFRESH_MS+1;fetcher.mockImplementation(async()=>new Response(null,{status:503}));const r=replySchema.parse(await (await h(new Request('https://local/snapshot'))).json());expect(r.status.state).toBe('stale');expect(r.snapshot?.report_end).toBe('2026-10-24');});
});

describe('MOF source update revision monotonicity',()=>{
 it.each(['warm','cold'])('rejects older file updates before publication in a %s handler',async mode=>{
  let now=Date.parse(START);const gate=new Gate();
  const fetcher=vi.fn(async()=>new Response(csv(),{headers:{'content-type':'text/csv'}}));
  const options={gate,fetcher:fetcher as typeof fetch,now:()=>now,isolatedForTests:true};
  const firstHandler=createJapanMofHandler(options);
  const first=replySchema.parse(await (await firstHandler(new Request('https://local/snapshot'))).json());
  const originalPayload=gate.snapshot;
  now+=REFRESH_MS+1;
  const older=mofFixture();older[1][19]='Final Update October 28 , 2026';older[14][12]='101';older[14][14]='61';older[14][18]='36';older[14][22]='26';
  fetcher.mockImplementation(async()=>new Response(csv(older),{headers:{'content-type':'text/csv'}}));
  const handler=mode==='warm'?firstHandler:createJapanMofHandler(options);
  const result=replySchema.parse(await (await handler(new Request('https://local/snapshot'))).json());
  expect(fetcher).toHaveBeenCalledTimes(2);expect(result.status.state).toBe('stale');expect(result.status.error_code).toBe('updated_date_regression');
  expect(result.snapshot).toEqual(first.snapshot);expect(result.snapshot?.fetched_at).toBe(START);expect(gate.snapshot).toEqual(originalPayload);expect(gate.state).toBe('idle');
 });
 it.each(['29','30'])('accepts same-period revisions with October %s update',async day=>{
  let now=Date.parse(START);const gate=new Gate();const fetcher=vi.fn(async()=>new Response(csv(),{headers:{'content-type':'text/csv'}}));
  const h=createJapanMofHandler({gate,fetcher:fetcher as typeof fetch,now:()=>now,isolatedForTests:true});
  await h(new Request('https://local/snapshot'));now+=REFRESH_MS+1;
  const revision=mofFixture();revision[1][19]=`Final Update October ${day} , 2026`;revision[14][12]='101';revision[14][14]='61';revision[14][18]='36';revision[14][22]='26';
  fetcher.mockImplementation(async()=>new Response(csv(revision),{headers:{'content-type':'text/csv'}}));
  const result=replySchema.parse(await (await h(new Request('https://local/snapshot'))).json());expect(result.status.state).toBe('available');expect(result.status.error_code).toBeNull();expect(result.snapshot?.total_net).toBe(26);expect(result.snapshot?.updated_date).toBe(`2026-10-${day}`);expect(result.snapshot?.fetched_at).toBe(new Date(now).toISOString());
 });
});
