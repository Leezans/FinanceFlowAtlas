import {describe,expect,it} from 'vitest';
import {projectFxVenue,FX_VENUE_PAIRS} from '../lib/fx/venue';
import {fxVenueGroups} from '../components/forex/venue-matrix';
import {validateKrakenReply} from '../components/crypto/client';
import {fxVenueReply} from './fx-venue-fixture';
describe('bounded Kraken fiat projection',()=>{
 it('reuses validated evidence and excludes crypto, stablecoins, inverse and synthetic crosses',()=>{
  const raw=validateKrakenReply(fxVenueReply()),result=projectFxVenue(raw.snapshot,raw.trade_snapshot)!;
  expect(result.rows.map(row=>row.pair)).toEqual(FX_VENUE_PAIRS);expect(result.rows).toHaveLength(3);expect(result.missing).toEqual([]);
  expect(result.rows[0].rate).toBe('2');expect(result.rows[0].volume_base_24h).toBe('7.12500');
  expect(result.source_observed_at).toBeNull();expect(result.source_delay_ms).toBeNull();expect(result.net_capital_flow).toBeNull();
 });
 it('never promotes the separate execution clock into the quote clock',()=>{
  const raw=fxVenueReply(),result=projectFxVenue(raw.snapshot,raw.trade_snapshot)!;
  expect(result.rows[0].trade_evidence?.last_execution_at).toBe('2026-11-05T02:59:50.000Z');
  expect(result.rows.every(row=>row.source_observed_at===null)).toBe(true);
  expect(result.fetched_at).toBe(raw.snapshot!.fetched_at);expect(result.acquisition_started_at).toBe(raw.snapshot!.acquisition_started_at);
 });
 it.each(['window','selection','acquisition','identity'])('does not reuse mismatching %s execution evidence',kind=>{
  const raw=fxVenueReply(),trades=raw.trade_snapshot!;
  if(kind==='window')trades.window_ended_at='2026-11-05T02:59:00.000Z';
  if(kind==='selection')trades.selected_pairs=['BTC/USD'];
  if(kind==='acquisition')trades.fetched_at='2026-11-05T02:59:00.000Z';
  if(kind==='identity')trades.rows.forEach(row=>{row.source_pair='UNKNOWN';});
  expect(projectFxVenue(raw.snapshot,trades)!.rows.every(row=>row.trade_evidence===null)).toBe(true);
 });
 it('represents absent, invalid and unexpected-identity rows as missing without zero tiles',()=>{
  const raw=fxVenueReply();raw.snapshot!.rows=raw.snapshot!.rows.filter(row=>row.pair!=='EUR/USD'&&row.pair!=='GBP/USD');
  raw.snapshot!.missing=[{pair:'GBP/USD',reason:'invalid_ticker'}];
  raw.snapshot!.rows.find(row=>row.pair==='AUD/USD')!.source_pair='OTHER';
  const result=projectFxVenue(raw.snapshot)!;
  expect(result.rows).toEqual([]);expect(result.missing).toEqual([{pair:'AUD/USD',reason:'identity_mismatch'},{pair:'EUR/USD',reason:'not_in_online_catalog'},{pair:'GBP/USD',reason:'invalid_ticker'}]);
  expect(fxVenueGroups(result,'rate')).toEqual([]);expect(projectFxVenue(null)).toBeNull();
 });
 it('keeps executed-zero timestamps null and capped observations explicitly incomplete',()=>{
  const raw=fxVenueReply(),row=raw.trade_snapshot!.rows[0];row.trade_count=0;row.first_trade_at=null;row.last_trade_at=null;row.coverage='capped_response';
  const evidence=projectFxVenue(raw.snapshot,raw.trade_snapshot)!.rows[0].trade_evidence!;
  expect(evidence.count).toBe(0);expect(evidence.last_execution_at).toBeNull();expect(evidence.coverage).toBe('capped_response');
 });
 it('uses equal area and price/VWAP comparison, not daily returns or capital flow',()=>{
  const raw=fxVenueReply(),snapshot=projectFxVenue(raw.snapshot)!,rates=fxVenueGroups(snapshot,'rate')[0].items;
  expect(rates.every(row=>row.amount===undefined)).toBe(true);expect(rates[0].colorValue).toBeCloseTo(-100/3);expect(rates[1].colorValue).toBe(0);
  expect(rates[0].detail).toContain('不是日涨跌');expect(fxVenueGroups(snapshot,'volume_base_24h')[0].items[0].displayValue).toBe('7.125 AUD');
  for(const metric of ['vwap_24h','volume_base_24h','trades_24h'] as const)expect(fxVenueGroups(snapshot,metric)[0].items.every(row=>row.colorValue===null&&row.amount===undefined)).toBe(true);
 });
});
