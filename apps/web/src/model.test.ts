import {describe,it,expect} from 'vitest';
import {filterPositions,validateSnapshot,POLL_MS} from './model';
const p={reporter_iso3:'USA',counterpart_iso3:'JPN',value_usd:0,period:'2025-S2',source_id:'imf',record_id:'1'};
const snapshot={countries:[],positions:[p],sources:[],metadata:{concept:'position',asset_class:'equity',unit_verified:true}};
describe('honest position semantics',()=>{
 it('preserves reported zero rather than treating it as missing',()=>expect(validateSnapshot(snapshot).positions[0].value_usd).toBe(0));
 it('rejects unverified units',()=>expect(()=>validateSnapshot({...snapshot,metadata:{...snapshot.metadata,unit_verified:false}})).toThrow());
 it('rejects nonfinite and negative values',()=>{for(const value_usd of [NaN,Infinity,-1])expect(()=>validateSnapshot({...snapshot,positions:[{...p,value_usd}]})).toThrow()});
 it('filters directional holdings and periods',()=>{expect(filterPositions([p],'USA','held_by','2025-S2','',[])).toEqual([p]);expect(filterPositions([p],'USA','issued_by','','',[])).toEqual([]);expect(filterPositions([p],'','both','2024-S2','',[])).toEqual([])});
 it('polls every 60 seconds',()=>expect(POLL_MS).toBe(60000));
});
