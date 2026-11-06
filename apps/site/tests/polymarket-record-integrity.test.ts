import {describe,expect,it} from 'vitest';
import {parseHotPolymarket,parsePolymarket} from '../lib/polymarket/adapter';
import {market,ISO} from './polymarket-fixture';
const modes=[['hot',parseHotPolymarket],['newest',parsePolymarket]] as const;
describe.each(modes)('%s source record integrity',(_mode,parse)=>{
 it.each([
  '2026-02-30T11:59:00Z','2025-02-29T11:59:00Z','2026-04-31T11:59:00Z',
  '2026-02-30T11:59:00.123456+08:00','2026-01-01T24:00:00Z',
 ])('excludes impossible calendar timestamp %s instead of normalizing it',updatedAt=>{
  const result=parse([market('3'),market('2',{updatedAt})],ISO,ISO);
  expect(result.rows.map(row=>row.id)).toEqual(['3']);expect(result.excluded_market_count).toBe(1);expect(result.source_market_count).toBe(2);
 });
 it.each([
  ['2024-02-29T11:59:00.123456Z','2024-02-29T11:59:00.123Z'],
  ['2026-11-05T19:59:00.123456+08:00','2026-11-05T11:59:00.123Z'],
  ['2026-11-05T03:59:00.123456-08:00','2026-11-05T11:59:00.123Z'],
  ['2000-02-29T00:00:00Z','2000-02-29T00:00:00.000Z'],
 ])('retains valid calendar precision and offset %s',(updatedAt,expected)=>{
  const result=parse([market('3',{updatedAt})],ISO,ISO);expect(result.rows[0].source_record_updated_at).toBe(expected);expect(result.rows[0].source_observed_at).toBeNull();
 });
 it.each(['outcomes','outcomePrices'])('excludes just the row with malformed encoded %s',field=>{
  for(const encoded of ['not-json','[invalid]','["Yes","No",]','["Yes",{"x":1,"x":2}]','['.repeat(22)+'0'+']'.repeat(22),'["Yes",1e400]']){
   const result=parse([market('3'),market('2',{[field]:encoded})],ISO,ISO);
   expect(result.rows.map(row=>row.id)).toEqual(['3']);expect(result.excluded_market_count).toBe(1);expect(result.source_market_count).toBe(2);
  }
 });
 it('still rejects an all-invalid acquisition rather than publishing an empty sample',()=>{
  expect(()=>parse([market('2',{outcomePrices:'not-json'})],ISO,ISO)).toThrow('invalid_snapshot');
 });
});
