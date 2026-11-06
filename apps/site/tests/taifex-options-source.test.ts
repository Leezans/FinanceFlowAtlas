import {describe,expect,it} from 'vitest';
import {TAIFEX_URL,parseTaifex} from '../lib/options/taifex/adapter';
import {MAX_CACHE_AGE_MS,reportAge,visibleSnapshot} from '../lib/options/taifex/model';
import {at,iso,taifexPayload,taifexReply} from './taifex-options-fixture';

describe('TAIFEX official daily source contract',()=>{
 it('uses exactly one fixed official URL and retains all 30 synthetic source rows',()=>{
  expect(TAIFEX_URL).toBe('https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfCallsAndPutsBytheDate');
  const s=parseTaifex(taifexPayload(),iso,iso);
  expect(s.rows).toHaveLength(30);expect(new Set(s.rows.map(row=>row.id)).size).toBe(30);
  expect(s.report_date).toBe('2026-11-05');expect(s.source_released_at).toBeNull();expect(s.frequency).toBe('daily');
  expect(s.source_unit).toBe('thousand_TWD');expect(s.currency).toBe('TWD');expect(s.net_capital_flow).toBeNull();
  expect(s.rows[0]).toMatchObject({buy_contracts:10,buy_amount:12000,sell_amount:9000,reported_net_amount:4000,long_oi_amount:15000,short_oi_amount:6000,reported_net_oi_amount:9000});
  expect(s.rows[0].reported_net_amount).not.toBe(s.rows[0].buy_amount-s.rows[0].sell_amount);
 });
 it.each(['missing','duplicate','extra','mixed-date','unknown-product','invalid-date','future-date'])('rejects %s rather than publishing partial or invented evidence',kind=>{
  const p=taifexPayload();
  if(kind==='missing')p.pop();if(kind==='duplicate')p[1]={...p[0]};if(kind==='extra')p.push({...p[0]});
  if(kind==='mixed-date')p[1].Date='20261104';if(kind==='unknown-product')p[0].ContractCode='unverified';
  if(kind==='invalid-date')p.forEach(row=>row.Date='20260230');if(kind==='future-date')p.forEach(row=>row.Date='20261107');
  expect(()=>parseTaifex(p,iso,iso)).toThrow();
 });
 it.each(['','1.5','-1','01','1e3',' 2','9007199254741'])('rejects ambiguous or unsafe source amount %j',value=>{
  const p=taifexPayload();p[0]['TradingValue(Long)(Thousands)']=value;expect(()=>parseTaifex(p,iso,iso)).toThrow();
 });
 it('preserves true zero rows and negative reported net values',()=>{
  const s=parseTaifex(taifexPayload(),iso,iso);expect(s.rows.filter(row=>row.product==='teo').every(row=>row.buy_amount===0&&row.reported_net_amount===0)).toBe(true);
  expect(s.rows.some(row=>row.reported_net_amount<0)).toBe(true);
 });
});

describe('TAIFEX options calendar and visibility contract',()=>{
 it('uses Taipei calendar boundaries without fabricating release times or market holidays',()=>{
  const s=taifexReply().snapshot!;expect(reportAge(s,Date.parse('2026-11-06T15:59:59.999Z'))).toBe(1);expect(reportAge(s,Date.parse('2026-11-06T16:00:00.000Z'))).toBe(2);
  expect(s.source_released_at).toBeNull();
 });
 it('shows cache only through the exact 24-hour and five-second clock-skew bounds',()=>{
  const r=taifexReply();expect(visibleSnapshot(r,at+MAX_CACHE_AGE_MS)).toEqual(r.snapshot);expect(visibleSnapshot(r,at+MAX_CACHE_AGE_MS+1)).toBeNull();
  expect(visibleSnapshot(r,at-5000)).toEqual(r.snapshot);expect(visibleSnapshot(r,at-5001)).toBeNull();expect(visibleSnapshot(r,NaN)).toBeNull();
  r.status.state='denied';expect(visibleSnapshot(r,at)).toBeNull();
 });
});
