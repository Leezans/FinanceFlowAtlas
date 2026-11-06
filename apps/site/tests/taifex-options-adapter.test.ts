import {describe,it,expect} from 'vitest';
import {parseTaifex,TaifexError,TAIFEX_URL,TAIFEX_DATASET,TAIFEX_LICENSE} from '../lib/options/taifex/adapter';
import {MAX_SOURCE_THOUSANDS} from '../lib/options/taifex/model';
import {iso,taifexPayload} from './taifex-options-fixture';
const parse=(payload:unknown)=>parseTaifex(payload,iso,iso);
const changed=(field:string,value:unknown)=>{const payload:Record<string,unknown>[]=taifexPayload();payload[0][field]=value;return payload;};
describe('TAIFEX official daily source adapter',()=>{
 it('has one fixed official endpoint with explicit open-data and license references',()=>{
  expect(TAIFEX_URL).toBe('https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfCallsAndPutsBytheDate');
  expect(TAIFEX_DATASET).toBe('https://data.gov.tw/dataset/11600');expect(TAIFEX_LICENSE).toBe('https://data.gov.tw/license');
  const error=new TaifexError('source_denied',true,60000);expect(error.message).toBe('source_denied');expect(error.denied).toBe(true);expect(error.retryAfterMs).toBe(60000);
 });
 it('maps exact official categories and scales source thousands to safe TWD without inferred flow',()=>{
  const s=parse(taifexPayload()),row=s.rows[0];
  expect(s.report_date).toBe('2026-11-05');expect(s.currency).toBe('TWD');expect(s.source_unit).toBe('thousand_TWD');expect(s.source_released_at).toBeNull();expect(s.net_capital_flow).toBeNull();
  expect([row.id,row.buy_amount,row.sell_amount,row.reported_net_amount,row.long_oi_amount,row.short_oi_amount,row.reported_net_oi_amount]).toEqual(['txo/call/dealer',12000,9000,4000,15000,6000,9000]);
  expect([row.buy_contracts,row.sell_contracts,row.net_contracts,row.long_oi_contracts,row.short_oi_contracts,row.net_oi_contracts]).toEqual([10,7,3,5,2,3]);
  expect(s.rows.find(row=>row.id==='etf/put/foreign')).toBeTruthy();expect(s.rows.find(row=>row.id==='teo/call/dealer')!.buy_amount).toBe(0);
  expect(s.acquisition_started_at).toBe(iso);expect(s.fetched_at).toBe(iso);
 });
 it('does not require a fabricated source currency field and rejects unrecognized source fields',()=>{
  expect(parse(taifexPayload()).currency).toBe('TWD');expect(()=>parse(changed('Currency','USD'))).toThrow(TaifexError);
  expect(()=>parse(changed('ContractCode','台指選擇權'))).toThrow();expect(()=>parse(changed('Item','外資'))).toThrow();expect(()=>parse(changed('CallPut','call'))).toThrow();
 });
 it('rejects missing, undefined, null, numeric and noncanonical numeric strings',()=>{
  for(const value of [undefined,null,1,true,'',' 1','1 ','01','+1','-0','1.0','1e3','1,000','NaN','Infinity','-1'])expect(()=>parse(changed('TradingValue(Long)(Thousands)',value))).toThrow(TaifexError);
  for(const value of [undefined,null,1,'','-0','+1','-01','1.5','1e3',' 1'])expect(()=>parse(changed('TradingVolume(Net)',value))).toThrow(TaifexError);
  for(const field of Object.keys(taifexPayload()[0])){const payload=taifexPayload();delete payload[0][field];expect(()=>parse(payload)).toThrow(TaifexError);}
 });
 it('rejects overflowing integers and thousands before multiplication but permits exact safe boundary',()=>{
  expect(()=>parse(changed('TradingVolume(Long)','9007199254740992'))).toThrow();expect(()=>parse(changed('TradingVolume(Net)','-9007199254740992'))).toThrow();
  expect(()=>parse(changed('TradingValue(Long)(Thousands)',String(MAX_SOURCE_THOUSANDS+1)))).toThrow();
  expect(()=>parse(changed('TradingValue(Net)(Thousands)',String(-MAX_SOURCE_THOUSANDS-1)))).toThrow();
  const payload=taifexPayload();payload.forEach(row=>{row['TradingValue(Long)(Thousands)']=row['TradingValue(Short)(Thousands)']=row['TradingValue(Net)(Thousands)']='0';});payload[0]['TradingValue(Long)(Thousands)']=payload[0]['TradingValue(Short)(Thousands)']=String(MAX_SOURCE_THOUSANDS);payload[0]['TradingValue(Net)(Thousands)']='0';
  expect(parse(payload).rows[0].buy_amount).toBe(MAX_SOURCE_THOUSANDS*1000);
  payload[1]['TradingValue(Long)(Thousands)']=payload[1]['TradingValue(Net)(Thousands)']='1';expect(()=>parse(payload)).toThrow('invalid_snapshot');
 });
 it('rejects empty, partial, duplicate, oversized and non-array reports instead of inventing absent categories',()=>{
  const payload=taifexPayload();for(const value of [[],null,{},'[]',payload.slice(1),[...payload,payload[0]],payload.map((row,i)=>i===1?payload[0]:row)])expect(()=>parse(value)).toThrow(TaifexError);
 });
 it('rejects mixed report dates, invalid dates, future dates and reversed acquisition times',()=>{
  expect(()=>parse(changed('Date','20261104'))).toThrow('mixed_report_dates');
  for(const date of ['20260229','20260431','20261107','2026-11-05'])expect(()=>parse(taifexPayload().map(row=>({...row,Date:date})))).toThrow();
  expect(()=>parseTaifex(taifexPayload(),iso,'2026-11-06T02:59:59Z')).toThrow();expect(()=>parseTaifex(taifexPayload(),'invalid',iso)).toThrow();
 });

 it.each([
  ['TradingVolume(Long)','TradingValue(Long)(Thousands)','TradingVolume(Net)','TradingValue(Net)(Thousands)',1],
  ['TradingVolume(Short)','TradingValue(Short)(Thousands)','TradingVolume(Net)','TradingValue(Net)(Thousands)',-1],
  ['OpenInterest(Long)','ContractValueofOpenInterest(Long)(Thousands)','OpenInterest(Net)','ContractValueofOpenInterest(Net)(Thousands)',1],
  ['OpenInterest(Short)','ContractValueofOpenInterest(Short)(Thousands)','OpenInterest(Net)','ContractValueofOpenInterest(Net)(Thousands)',-1],
 ] as const)('validates source zero-count relationship for %s',(count,amount,netCount,netAmount,sign)=>{
  const invalid=taifexPayload();invalid[6][amount]='1';invalid[6][netAmount]=String(sign);
  expect(()=>parse(invalid)).toThrow('invalid_snapshot');
  const roundedSmall=taifexPayload();roundedSmall[6][count]='1';roundedSmall[6][netCount]=String(sign);
  expect(()=>parse(roundedSmall)).not.toThrow();
 });
 it('retains signed source nets with one-thousand rounding and rejects count or larger monetary imbalance',()=>{
  for(const value of ['2','3','4'])expect(parse(changed('TradingValue(Net)(Thousands)',value)).rows[0].reported_net_amount).toBe(Number(value)*1000);
  for(const value of ['1','5'])expect(()=>parse(changed('TradingValue(Net)(Thousands)',value))).toThrow();
  expect(()=>parse(changed('TradingVolume(Net)','4'))).toThrow();expect(()=>parse(changed('OpenInterest(Net)','4'))).toThrow();
  expect(()=>parse(changed('ContractValueofOpenInterest(Net)(Thousands)','11'))).toThrow();
  const negative=taifexPayload();negative[0]['TradingValue(Short)(Thousands)']='17';negative[0]['TradingValue(Net)(Thousands)']='-5';
  expect(parse(negative).rows[0].reported_net_amount).toBe(-5000);
 });
});
