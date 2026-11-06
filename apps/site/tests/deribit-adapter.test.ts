import {describe,it,expect} from 'vitest';
import {SUMMARY_URL,SUMMARY_URLS,INSTRUMENTS_URL,INSTRUMENTS_URLS,parseMetadata,parseSummary,reusableMetadata,resultRows,combineSnapshots} from '../lib/options/adapter';
import {METADATA_MAX_AGE_MS,type OptionCurrency} from '../lib/options/model';
import {at,iso,combinedOptionsReply,singleCurrencyOptionsReply} from './deribit-fixture';
const envelope=(result:unknown[])=>({jsonrpc:'2.0',testnet:false,result});
const rows=(currency:OptionCurrency)=>singleCurrencyOptionsReply(currency).snapshot!.rows;
const summary=(currency:OptionCurrency)=>envelope(rows(currency).map(r=>({...r,instrument_name:r.instrument,base_currency:currency,quote_currency:currency})));
const metadata=(currency:OptionCurrency)=>envelope(rows(currency).map(r=>({...r,instrument_name:r.instrument,base_currency:currency,quote_currency:currency,settlement_currency:currency,counter_currency:'USD',kind:'option',is_active:true})));
const parse=(currency:OptionCurrency)=>parseSummary(resultRows(summary(currency)),parseMetadata(metadata(currency),currency),iso,iso,iso,currency);
describe('BTC and ETH official source adapters',()=>{
 it('exposes only the two fixed official URL maps and keeps BTC aliases',()=>{
  expect(SUMMARY_URL).toBe(SUMMARY_URLS.BTC);expect(INSTRUMENTS_URL).toBe(INSTRUMENTS_URLS.BTC);
  expect(Object.keys(SUMMARY_URLS)).toEqual(['BTC','ETH']);expect(Object.keys(INSTRUMENTS_URLS)).toEqual(['BTC','ETH']);
  expect(SUMMARY_URLS.ETH).toBe('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=ETH&kind=option');
  expect(INSTRUMENTS_URLS.ETH).toBe('https://www.deribit.com/api/v2/public/get_instruments?currency=ETH&kind=option&expired=false');
 });
 it.each(['BTC','ETH'] as const)('preserves %s source values without calculating USD amounts or net flow',currency=>{
  const s=parse(currency);expect(s.schema).toBe('deribit-options/2');expect(s.currencies).toEqual([currency]);expect(s.rows).toEqual(rows(currency));expect(s.metadata_fetched_at).toEqual({[currency]:iso});expect(s.net_capital_flow).toBeNull();
 });
 it.each(['base_currency','quote_currency','settlement_currency','counter_currency','expiration_timestamp','strike','contract_size','option_type'])('requires the authoritative metadata field %s',key=>{
  for(const currency of ['BTC','ETH'] as const){const payload=metadata(currency);delete (payload.result[0] as Record<string,unknown>)[key];expect(()=>parseMetadata(payload,currency)).toThrow('unexpected_option_metadata');}
 });
 it('rejects wrong currencies, nonfinite or zero metadata, and instrument contradictions',()=>{
  for(const patch of [{base_currency:'BTC'},{quote_currency:'USD'},{settlement_currency:'BTC'},{counter_currency:'ETH'},{strike:'3000'},{strike:3001},{contract_size:0},{contract_size:Infinity},{expiration_timestamp:at},{option_type:'put'},{instrument_name:'BTC-27NOV26-3000-C'}]){
   const payload=metadata('ETH');Object.assign(payload.result[0] as object,patch);expect(()=>parseMetadata(payload,'ETH')).toThrow('unexpected_option_metadata');
  }
 });
 it('never fills missing source USD turnover from underlying price or volume',()=>{
  const summaryRows=resultRows(summary('ETH'));delete summaryRows[0].volume_usd;summaryRows[0].underlying_price=3000;
  expect(()=>parseSummary(summaryRows,parseMetadata(metadata('ETH'),'ETH'),iso,iso,iso,'ETH')).toThrow('invalid_snapshot');
  summaryRows[0].volume_usd=7;summaryRows[0].price_change=null;
  const s=parseSummary(summaryRows,parseMetadata(metadata('ETH'),'ETH'),iso,iso,iso,'ETH');expect(s.rows[0].volume_usd).toBe(7);expect(s.rows[0].price_change).toBeNull();
 });
 it('rejects cross-currency summaries, missing rows and duplicates',()=>{
  const m=parseMetadata(metadata('ETH'),'ETH'),r=resultRows(summary('ETH'));
  expect(()=>parseSummary(r,m,iso,iso,iso,'BTC')).toThrow();
  expect(()=>parseSummary(r.slice(1),m,iso,iso,iso,'ETH')).toThrow();
  expect(()=>parseSummary([r[0],r[0],r[2]],m,iso,iso,iso,'ETH')).toThrow();
  r[0].base_currency='BTC';expect(()=>parseSummary(r,m,iso,iso,iso,'ETH')).toThrow('unexpected_option');
 });
 it('reuses only the matching currency and its own unexpired metadata clock',()=>{
  const s=combinedOptionsReply().snapshot!;
  s.metadata_fetched_at.BTC=new Date(at-METADATA_MAX_AGE_MS-1).toISOString();
  expect(reusableMetadata(s,resultRows(summary('BTC')),at,'BTC')).toBeNull();
  expect(reusableMetadata(s,resultRows(summary('ETH')),at,'ETH')).toHaveLength(3);
  expect(reusableMetadata(singleCurrencyOptionsReply('BTC').snapshot,resultRows(summary('ETH')),at,'ETH')).toBeNull();
  expect(reusableMetadata(s,resultRows(summary('ETH')).slice(1),at,'ETH')).toBeNull();
  s.metadata_fetched_at.ETH=new Date(at+1).toISOString();expect(reusableMetadata(s,resultRows(summary('ETH')),at,'ETH')).toBeNull();
 });
 it('combines exactly BTC and ETH canonically, preserving rows and per-source clocks',()=>{
  const btc=parse('BTC'),eth=parse('ETH');
  eth.rows=eth.rows.map(row=>({...row,creation_timestamp:at+1000}));eth.source_as_of=new Date(at+1000).toISOString();eth.fetched_at=new Date(at+2000).toISOString();eth.metadata_fetched_at.ETH=eth.fetched_at;
  const combined=combineSnapshots([eth,btc]);
  expect(combined.currencies).toEqual(['BTC','ETH']);expect(combined.coverage).toBe('deribit_btc_eth_options');expect(combined.rows).toEqual([...btc.rows,...eth.rows]);expect(combined.source_as_of).toBe(btc.source_as_of);expect(combined.fetched_at).toBe(eth.fetched_at);expect(combined.metadata_fetched_at).toEqual({BTC:iso,ETH:eth.fetched_at});
  expect(()=>combineSnapshots([btc])).toThrow('incomplete_option_coverage');expect(()=>combineSnapshots([btc,btc])).toThrow('incomplete_option_coverage');expect(()=>combineSnapshots([combined,eth])).toThrow('incomplete_option_coverage');
 });
 it('rejects independently acquired currency snapshots even when their row times match',()=>{
  const btc=parse('BTC'),eth=parse('ETH');eth.acquisition_started_at=new Date(at-1).toISOString();
  expect(()=>combineSnapshots([btc,eth])).toThrow('incoherent_option_acquisition');
 });
 it('rejects individually valid snapshots more than five seconds apart',()=>{
  const btc=parse('BTC'),eth=parse('ETH');
  eth.rows=eth.rows.map(row=>({...row,creation_timestamp:at+5001}));eth.source_as_of=new Date(at+5001).toISOString();eth.fetched_at=eth.source_as_of;
  expect(()=>combineSnapshots([btc,eth])).toThrow('invalid_combined_snapshot');
 });
});
