import {describe,it,expect} from 'vitest';
import {parseHotPolymarket,parsePolymarket} from '../lib/polymarket/adapter';
import {parseOpenInterest} from '../lib/polymarket/interest';
import {maximumCacheAge,selectSnapshot,storedCacheSchema,updateStoredCache,type PolymarketView} from '../lib/polymarket/model';
import {market,NOW} from './polymarket-fixture';

const modes:PolymarketView[]=['hot','newest','interest'];
function sample(mode:PolymarketView,at:number){
 const iso=new Date(at).toISOString(),rows=[market('3',{updatedAt:null,conditionId:'0x'+'1'.repeat(64)})];
 if(mode==='newest')return parsePolymarket(rows,iso,iso);
 const hot=parseHotPolymarket(rows,iso,iso);
 return mode==='hot'?hot:parseOpenInterest({data:[]},hot,iso,iso);
}
const cases=modes.flatMap(prior=>modes.filter(next=>next!==prior).flatMap(next=>[
 {prior,next,age:maximumCacheAge(prior)-1,keep:true},
 {prior,next,age:maximumCacheAge(prior),keep:true},
 {prior,next,age:maximumCacheAge(prior)+1,keep:false},
 {prior,next,age:-1,keep:true},
]));
describe('bounded Polymarket cache retention on successful replacement',()=>{
 it.each(cases)('$next replacement retains $prior age $age only within its own lifetime',({prior,next,age,keep})=>{
  const previous=sample(prior,NOW-age),fresh=sample(next,NOW),other=modes.find(mode=>mode!==prior&&mode!==next)!;
  const unchanged=sample(other,NOW-1000);
  const cache=storedCacheSchema.parse({schema:'polymarket-discovery/2',hot:null,newest:null,interest:null,[prior]:previous,[other]:unchanged});
  const raw=JSON.stringify(cache),result=updateStoredCache(cache,fresh);
  expect(selectSnapshot(result,prior)).toEqual(keep?previous:null);
  expect(selectSnapshot(result,next)).toEqual(fresh);
  expect(selectSnapshot(result,other)).toEqual(unchanged);
  expect(JSON.stringify(cache)).toBe(raw);
  expect(storedCacheSchema.safeParse(result).success).toBe(true);
 });
 it('reclaims expired legacy v1 evidence without relabeling it as a hot window',()=>{
  const prior=sample('newest',NOW-maximumCacheAge('newest')-1) as Record<string,unknown>;
  const legacy={...prior,schema:'polymarket-gamma/1',sample_limit:200,ordering:'source_volume24hr_descending'};
  for(const field of ['total_market_count','pagination','source_page_count','source_page_sizes','stop_reason','has_more','grouping'])delete legacy[field as keyof typeof legacy];
  const cache=storedCacheSchema.parse(legacy),fresh=sample('hot',NOW),result=updateStoredCache(cache,fresh);
  expect(result).toEqual(fresh);expect(selectSnapshot(result,'newest')).toBeNull();
 });
});
