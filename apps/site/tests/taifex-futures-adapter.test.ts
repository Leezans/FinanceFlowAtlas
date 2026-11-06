import {describe,it,expect} from 'vitest';
import {parseFutures,FuturesError,FUTURES_URL,FUTURES_DATASET,FUTURES_LICENSE} from '../lib/futures/taifex/adapter';
import {MAX_SOURCE_THOUSANDS,PRODUCTS} from '../lib/futures/taifex/model';
import {STARTED,FETCHED,makeFuturesFixture} from './taifex-futures-fixture';
const parse=(payload:unknown)=>parseFutures(payload,STARTED,FETCHED);
const changed=(field:string,value:unknown)=>{const payload:Record<string,unknown>[]=makeFuturesFixture();payload[0][field]=value;return payload;};
const unknownGroup=(name='Unverified futures')=>makeFuturesFixture().slice(0,3).map(row=>({...row,ContractCode:name}));
describe('TAIFEX futures strict official daily adapter',()=>{
 it('uses one fixed official endpoint and exact data/license references',()=>{
  expect(FUTURES_URL).toBe('https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate');
  expect(FUTURES_DATASET).toBe('https://data.gov.tw/dataset/11596');expect(FUTURES_LICENSE).toBe('https://data.gov.tw/license');
  const error=new FuturesError('source_denied',true,60000);expect(error.message).toBe('source_denied');expect(error.denied).toBe(true);expect(error.retryAfterMs).toBe(60000);
 });
 it('scales source thousands exactly into TWD contract notional, without a fabricated release or flow',()=>{
  const s=parse(makeFuturesFixture()),row=s.rows[0];
  expect(s.report_date).toBe('2026-11-05');expect(s.currency).toBe('TWD');expect(s.source_unit).toBe('thousand_TWD');expect(s.metric).toBe('contract_notional_turnover');
  expect(s.source_released_at).toBeNull();expect(s.net_capital_flow).toBeNull();expect(s.source_product_count).toBe(23);expect(s.covered_products).toHaveLength(23);expect(s.rows).toHaveLength(69);
  expect([row.id,row.buy_amount,row.sell_amount,row.reported_net_amount,row.long_oi_amount,row.short_oi_amount,row.reported_net_oi_amount]).toEqual(['tx/dealer',3000,2000,1000,5000,4000,1000]);
  expect([row.buy_contracts,row.sell_contracts,row.net_contracts,row.long_oi_contracts,row.short_oi_contracts,row.net_oi_contracts]).toEqual([3,2,1,5,4,1]);
  expect(s.rows.find(row=>row.id==='m1f/foreign')).toBeTruthy();expect(s.rows.find(row=>row.id==='etf/foreign')).toBeTruthy();
  expect(s.acquisition_started_at).toBe(STARTED);expect(s.fetched_at).toBe(FETCHED);
 });
 it('accepts every verified index and aggregate, including foreign underlyings denominated in TWD',()=>{
  expect(PRODUCTS).toHaveLength(23);expect(new Set(PRODUCTS.map(p=>p.id)).size).toBe(23);expect(new Set(PRODUCTS.map(p=>p.label)).size).toBe(23);
  for(const product of PRODUCTS){const s=parse(makeFuturesFixture().filter(row=>row.ContractCode===product.label));expect(s.covered_products).toEqual([product.id]);expect(s.rows).toHaveLength(3);expect(s.currency).toBe('TWD');expect(product.definition_url).toMatch(/^https:\/\/www\.taifex\.com\.tw\/cht\//);}
 });
 it('supports variable present-product coverage without hard-coded totals or synthetic missing zeroes',()=>{
  const input=makeFuturesFixture().filter(row=>row.ContractCode!=='臺灣中型100期貨'),s=parse(input);
  expect(s.source_product_count).toBe(22);expect(s.covered_products).toHaveLength(22);expect(s.covered_products).not.toContain('m1f');expect(s.rows).toHaveLength(66);expect(s.excluded_product_count).toBe(0);expect(s.excluded_row_count).toBe(0);
  const minimal=parse(input.slice(0,3));expect(minimal.rows).toHaveLength(3);expect(minimal.covered_products).toEqual(['tx']);
 });
 it('excludes complete unknown groups while retaining verified products and disclosing exact exclusions',()=>{
  const s=parse([...makeFuturesFixture(),...unknownGroup(),...unknownGroup('A second unknown futures')]);
  expect(s.source_product_count).toBe(25);expect(s.excluded_product_count).toBe(2);expect(s.excluded_row_count).toBe(6);expect(s.rows).toHaveLength(69);expect(s.covered_products).toEqual(PRODUCTS.map(p=>p.id));
  expect(()=>parse(unknownGroup())).toThrow('unsupported_products');
 });
 it('does not treat unknown groups as permission to relax structure, participant, balances or dates',()=>{
  for(const patch of [{extra:'1'},{Item:'總計'},{'TradingVolume(Net)':'2'},{'TradingValue(Long)(Thousands)':'3.5'},{'TradingVolume(Long)':'0'},{Date:'20261104'}]){
   const unknown=unknownGroup();Object.assign(unknown[0],patch);expect(()=>parse([...makeFuturesFixture(),...unknown])).toThrow(FuturesError);
  }
  expect(()=>parse([...makeFuturesFixture(),...unknownGroup().slice(0,2)])).toThrow('invalid_source_coverage');
  const duplicate=unknownGroup();duplicate[1]={...duplicate[0]};expect(()=>parse([...makeFuturesFixture(),...duplicate])).toThrow('invalid_source_coverage');
 });
 it('bounds every source report at 100 groups and 300 rows',()=>{
  const maximum=[...makeFuturesFixture().slice(0,3),...Array.from({length:99},(_,i)=>unknownGroup(`Unknown ${i}`)).flat()];
  const s=parse(maximum);expect(s.source_product_count).toBe(100);expect(s.excluded_product_count).toBe(99);expect(s.excluded_row_count).toBe(297);expect(s.rows).toHaveLength(3);
  expect(()=>parse([...maximum,...unknownGroup('Too many')])).toThrow('invalid_source_schema');
 });
 it('enforces exactly fifteen source fields, without CallPut or source currency coercions',()=>{
  expect(Object.keys(makeFuturesFixture()[0])).toHaveLength(15);
  for(const field of ['Currency','CallPut','unknown'])expect(()=>parse(changed(field,'CALL'))).toThrow('invalid_source_schema');
  expect(()=>parse(changed('Item','外資'))).toThrow();
  for(const value of ['', ' 臺股期貨','臺股期貨 ','bad\nlabel','x'.repeat(81)])expect(()=>parse(changed('ContractCode',value))).toThrow();
  for(const field of Object.keys(makeFuturesFixture()[0])){const payload=makeFuturesFixture();delete payload[0][field];expect(()=>parse(payload)).toThrow('invalid_source_schema');}
 });
 it('rejects missing, undefined, null, numeric and noncanonical numeric strings',()=>{
  for(const value of [undefined,null,1,true,'',' 1','1 ','01','+1','-0','1.0','1e3','1,000','NaN','Infinity','-1'])expect(()=>parse(changed('TradingValue(Long)(Thousands)',value))).toThrow(FuturesError);
  for(const value of [undefined,null,1,'','-0','+1','-01','1.5','1e3',' 1'])expect(()=>parse(changed('TradingVolume(Net)',value))).toThrow(FuturesError);
 });
 it('rejects overflowing integers before multiplication and accepts an exact safe monetary boundary',()=>{
  expect(()=>parse(changed('TradingVolume(Long)','9007199254740992'))).toThrow();expect(()=>parse(changed('TradingVolume(Net)','-9007199254740992'))).toThrow();
  expect(()=>parse(changed('TradingValue(Long)(Thousands)',String(MAX_SOURCE_THOUSANDS+1)))).toThrow();expect(()=>parse(changed('TradingValue(Net)(Thousands)',String(-MAX_SOURCE_THOUSANDS-1)))).toThrow();
  const payload=makeFuturesFixture();payload.forEach(row=>{row['TradingValue(Long)(Thousands)']=row['TradingValue(Short)(Thousands)']=row['TradingValue(Net)(Thousands)']='0';});
  payload[0]['TradingValue(Long)(Thousands)']=payload[0]['TradingValue(Short)(Thousands)']=String(MAX_SOURCE_THOUSANDS);
  expect(parse(payload).rows[0].buy_amount).toBe(MAX_SOURCE_THOUSANDS*1000);
  payload[1]['TradingValue(Long)(Thousands)']=payload[1]['TradingValue(Net)(Thousands)']='1';expect(()=>parse(payload)).toThrow('invalid_snapshot');
 });
 it('rejects incomplete, duplicate and non-array reports',()=>{
  const payload=makeFuturesFixture();for(const value of [[],null,{},'[]',payload.slice(1),[...payload,payload[0]],payload.map((row,i)=>i===1?payload[0]:row)])expect(()=>parse(value)).toThrow(FuturesError);
 });
 it('rejects mixed/invalid/future report dates and reversed acquisition clocks',()=>{
  expect(()=>parse(changed('Date','20261104'))).toThrow('mixed_report_dates');
  for(const date of ['20260229','20260431','20261107','2026-11-05'])expect(()=>parse(makeFuturesFixture().map(row=>({...row,Date:date})))).toThrow();
  expect(()=>parseFutures(makeFuturesFixture(),STARTED,'2026-11-06T02:59:59Z')).toThrow();expect(()=>parseFutures(makeFuturesFixture(),'invalid',FETCHED)).toThrow();
 });
 it.each([
  ['TradingVolume(Long)','TradingValue(Long)(Thousands)','TradingVolume(Net)','TradingValue(Net)(Thousands)',1],
  ['TradingVolume(Short)','TradingValue(Short)(Thousands)','TradingVolume(Net)','TradingValue(Net)(Thousands)',-1],
  ['OpenInterest(Long)','ContractValueofOpenInterest(Long)(Thousands)','OpenInterest(Net)','ContractValueofOpenInterest(Net)(Thousands)',1],
  ['OpenInterest(Short)','ContractValueofOpenInterest(Short)(Thousands)','OpenInterest(Net)','ContractValueofOpenInterest(Net)(Thousands)',-1],
 ] as const)('requires zero %s to imply zero %s, but not the reverse',(count,amount,netCount,netAmount,sign)=>{
  const zero=makeFuturesFixture();for(const key of Object.keys(zero[0]).filter(key=>!['Date','ContractCode','Item'].includes(key)))zero[0][key]='0';
  expect(parse(zero).rows[0].buy_amount).toBe(0);
  const invalid=structuredClone(zero);invalid[0][amount]='1';invalid[0][netAmount]=String(sign);expect(()=>parse(invalid)).toThrow('invalid_source_balance');
  const roundedSmall=structuredClone(zero);roundedSmall[0][count]='1';roundedSmall[0][netCount]=String(sign);expect(()=>parse(roundedSmall)).not.toThrow();
 });
 it('retains signed source nets, with exactly one source-thousand rounding tolerance',()=>{
  for(const value of ['0','1','2'])expect(parse(changed('TradingValue(Net)(Thousands)',value)).rows[0].reported_net_amount).toBe(Number(value)*1000);
  for(const value of ['-1','3'])expect(()=>parse(changed('TradingValue(Net)(Thousands)',value))).toThrow('invalid_source_balance');
  for(const value of ['0','1','2'])expect(parse(changed('ContractValueofOpenInterest(Net)(Thousands)',value)).rows[0].reported_net_oi_amount).toBe(Number(value)*1000);
  expect(()=>parse(changed('TradingVolume(Net)','2'))).toThrow();expect(()=>parse(changed('OpenInterest(Net)','2'))).toThrow();expect(()=>parse(changed('ContractValueofOpenInterest(Net)(Thousands)','3'))).toThrow();
  const negative=makeFuturesFixture();negative[0]['TradingValue(Short)(Thousands)']='5';negative[0]['TradingValue(Net)(Thousands)']='-2';expect(parse(negative).rows[0].reported_net_amount).toBe(-2000);
 });
 it('normalizes product coverage deterministically without changing source row identities',()=>{
  const fixture=makeFuturesFixture();const s=parse([...fixture].reverse());expect(s.covered_products).toEqual(PRODUCTS.map(p=>p.id));expect(new Set(s.rows.map(row=>row.id))).toEqual(new Set(parse(fixture).rows.map(row=>row.id)));
 });
});
