import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createAshareHandler,FIELDS,type Row} from '../lib/ashare/ashare';
import {selectEvidenceRows,validateEvidence} from '../components/ashare/model';

// Independently generated synthetic records only. No provider requests/fixtures.
const row=(i:number,stocks=false):Row=>Object.fromEntries(FIELDS.map(field=>[
 field,field==='f12'?(stocks?String(i).padStart(6,'0'):`BK${String(i).padStart(4,'0')}`):field==='f14'?`Synthetic ${i}`:field==='f62'?i:1,
])) as Row;
const response=(rows:Row[],total:number)=>new Response(JSON.stringify({rc:0,data:{total,diff:rows}}),{headers:{'content-type':'application/json'}});
const request=(scope:string)=>new Request(`https://private.example/api/v1/ashare/snapshot?scope=${scope}`);
const make=(fetcher:(url:string,init:RequestInit)=>Promise<Response>)=>createAshareHandler({enabled:()=>true,isolatedForTests:true,fetcher});
async function settle<T>(pending:Promise<T>):Promise<T>{
 let done=false;void pending.then(()=>{done=true;},()=>{done=true;});
 for(let i=0;i<40&&!done;i++)await vi.advanceTimersByTimeAsync(500);
 return pending;
}
function movingProvider(stocks=false){
 let calls=0;
 return vi.fn(async(url:string)=>{
  const query=new URL(url).searchParams;
  const rows=Array.from({length:101},(_,i)=>row(i+1,stocks));
  // Lowest code jumps from the bottom to the top of flow ranking after page 1.
  if(++calls>1)rows[0].f62=1000;
  rows.sort(query.get('fid')==='f12'?(a,b)=>b.f12.localeCompare(a.f12):(a,b)=>Number(b.f62)-Number(a.f62));
  const start=(Number(query.get('pn'))-1)*Number(query.get('pz'));
  return response(rows.slice(start,start+Number(query.get('pz'))),rows.length);
 });
}

beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T02:00:00Z'));});
afterEach(()=>vi.useRealTimers());

describe('stable A-share acquisition paging',()=>{
 it('demonstrates how live-flow paging repeats and omits rows when ranks change',async()=>{
  const provider=movingProvider();
  const pages=await Promise.all([1,2].map(async page=>{
   const result=await provider(`https://synthetic.invalid/?fid=f62&pn=${page}&pz=100`);
   return (await result.json() as {data:{diff:Row[]}}).data.diff;
  }));
  const codes=pages.flat().map(value=>value.f12);
  expect(codes).toHaveLength(101);
  expect(new Set(codes).size).toBe(100);
  expect(codes.filter(code=>code==='BK0002')).toHaveLength(2);
  expect(codes).not.toContain('BK0001');
 });

 it.each([false,true])('keeps complete unique coverage while flows move (stocks=%s)',async stocks=>{
  const provider=movingProvider(stocks);
  const result=await settle(make(provider)(request(stocks?'BK0001':'level1')));
  expect(result.status).toBe(200);
  const snapshot=validateEvidence(await result.json());
  expect(snapshot).toMatchObject({source_total:101,page_count:2,source_observed_at:null,trade_date:null,delay_status:'not_provided'});
  expect(new Set(snapshot.rows.map(value=>value.f12)).size).toBe(101);
  expect(snapshot.rows.map(value=>value.f12)).toEqual(Array.from({length:101},(_,i)=>row(101-i,stocks).f12));
  expect(provider).toHaveBeenCalledTimes(2);
  const queries=provider.mock.calls.map(([url])=>new URL(url).searchParams);
  expect(queries.map(query=>query.get('pn'))).toEqual(['1','2']);
  for(const query of queries){
   expect(query.get('fid')).toBe('f12');expect(query.get('po')).toBe('1');
   expect(query.get('pz')).toBe('100');expect(query.get('fields')).toBe(FIELDS.join(','));
  }
  queries.forEach(query=>query.delete('pn'));
  expect(queries[0].toString()).toBe(queries[1].toString());
  // Output still ranks by real supplied flow, rather than by transport ordering.
  const ordered=selectEvidenceRows(snapshot.rows,'','all','net_desc');
  expect(ordered.slice(0,2).map(value=>value.f12)).toEqual([row(1,stocks).f12,row(101,stocks).f12]);
  expect(ordered[0].f62).toBe(1000);
  expect(snapshot.rows.at(-1)?.f12).toBe(row(1,stocks).f12);
 });

 it.each(['duplicate','changed_total','truncated'])('still rejects %s despite requesting stable order',async failure=>{
  let calls=0;
  const provider=vi.fn(async()=>++calls===1
   ?response(Array.from({length:100},(_,i)=>row(101-i)),101)
   :response(failure==='truncated'?[]:[row(failure==='duplicate'?2:1)],failure==='changed_total'?102:101));
  const result=await settle(make(provider)(request('level1')));
  expect(result.status).toBe(503);
  const payload=await result.json() as Record<string,unknown>;
  expect(payload.error_code).toBe({duplicate:'duplicate_id',changed_total:'unstable_total',truncated:'incomplete_page'}[failure]);
  expect(payload.rows).toBeUndefined();expect(JSON.stringify(payload)).not.toContain('Synthetic');
  expect(provider).toHaveBeenCalledTimes(2);
 });

 it('retains signed, zero and missing flows with UI sorting independent of code order',async()=>{
  const rows=[{...row(4),f62:null},{...row(3),f62:0},{...row(2),f62:-500},{...row(1),f62:100}];
  const result=await make(async()=>response(rows,4))(request('level1'));
  const snapshot=validateEvidence(await result.json());
  expect(snapshot.rows).toEqual(rows);
  expect(selectEvidenceRows(snapshot.rows,'','all','magnitude').map(value=>value.f12)).toEqual(['BK0002','BK0001','BK0003','BK0004']);
  expect(selectEvidenceRows(snapshot.rows,'','all','net_asc').map(value=>value.f12)).toEqual(['BK0002','BK0003','BK0001','BK0004']);
  expect(selectEvidenceRows(snapshot.rows,'','all','net_desc').map(value=>value.f12)).toEqual(['BK0001','BK0003','BK0002','BK0004']);
  expect(snapshot.rows).toEqual(rows);
 });
});
