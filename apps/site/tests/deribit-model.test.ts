import {describe,it,expect} from 'vitest';
import {MAX_ROWS,MAX_BYTES,MAX_CACHE_BYTES,METADATA_MAX_AGE_MS,snapshotSchema,replySchema,visibleSnapshot} from '../lib/options/model';
import {reusableMetadata} from '../lib/options/adapter';
import {at,iso,optionsReply,combinedOptionsReply,singleCurrencyOptionsReply} from './deribit-fixture';

function legacySnapshot(){
 const s=optionsReply().snapshot!;
 return {schema:'deribit-btc-options/1',source:s.source,currency:'BTC',coverage:'deribit_btc_options',acquisition_started_at:s.acquisition_started_at,fetched_at:s.fetched_at,source_as_of:s.source_as_of,metadata_fetched_at:iso,net_capital_flow:s.net_capital_flow,delay_policy:s.delay_policy,
  rows:s.rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='underlying_currency')))};
}
describe('Deribit combined snapshot contract',()=>{
 it('accepts only canonical supported coverage with per-row currency identity',()=>{
  for(const snapshot of [optionsReply().snapshot,singleCurrencyOptionsReply('ETH').snapshot,combinedOptionsReply().snapshot])expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
  const s=combinedOptionsReply().snapshot!;
  for(const patch of [{currencies:['ETH','BTC']},{currencies:['BTC','BTC']},{currencies:['BTC']},{currencies:['BTC','ETH','SOL']},{coverage:'deribit_btc_options'},{metadata_fetched_at:{BTC:iso}},{metadata_fetched_at:{BTC:iso,ETH:iso,SOL:iso}},{currency:'BTC'}])expect(snapshotSchema.safeParse({...s,...patch}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,rows:s.rows.filter(row=>row.underlying_currency==='BTC')}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,rows:s.rows.map((row,index)=>index===0?{...row,underlying_currency:'ETH'}:row)}).success).toBe(false);
 });
 it('keeps unchanged source bounds, with a separate combined cache budget and per-currency row cap',()=>{
  expect(MAX_ROWS).toBe(2000);expect(MAX_BYTES).toBe(1500000);expect(MAX_CACHE_BYTES).toBe(3000000);
  const s=combinedOptionsReply().snapshot!;
  const rows=s.currencies.flatMap(currency=>Array.from({length:2000},(_,i)=>({...s.rows.find(row=>row.underlying_currency===currency)!,instrument:`${currency}-27NOV26-${i+1}-C`,strike:i+1})));
  expect(snapshotSchema.safeParse({...s,rows}).success).toBe(true);
  expect(snapshotSchema.safeParse({...s,rows:[...rows,{...rows[0],instrument:'BTC-27NOV26-2001-C',strike:2001}]}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,rows:rows.map((row,index)=>index===2000?{...row,instrument:'BTC-27NOV26-2001-C',underlying_currency:'BTC',strike:2001}:row)}).success).toBe(false);
 });
 it('rejects inconsistent source clocks, metadata age and mixed snapshot spans',()=>{
  const s=combinedOptionsReply().snapshot!;
  expect(snapshotSchema.safeParse({...s,source_as_of:new Date(at-1).toISOString()}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,rows:s.rows.map((row,index)=>index===3?{...row,creation_timestamp:at+5001}:row)}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,metadata_fetched_at:{BTC:iso,ETH:new Date(at-METADATA_MAX_AGE_MS-1).toISOString()}}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,metadata_fetched_at:{BTC:iso,ETH:new Date(at+1).toISOString()}}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,rows:[...s.rows,s.rows[0]]}).success).toBe(false);
 });
 it('transforms exactly valid legacy BTC evidence without adding coverage or refreshing clocks',()=>{
  const legacy=legacySnapshot();legacy.source_as_of=new Date(at-1000).toISOString();
  const parsed=snapshotSchema.parse(legacy);
  expect(parsed.schema).toBe('deribit-options/2');expect(parsed.currencies).toEqual(['BTC']);expect(parsed.coverage).toBe('deribit_btc_options');
  expect(parsed.metadata_fetched_at).toEqual({BTC:iso});expect(parsed.source_as_of).toBe(legacy.source_as_of);expect(parsed.fetched_at).toBe(legacy.fetched_at);expect(parsed.acquisition_started_at).toBe(legacy.acquisition_started_at);
  expect(parsed.rows.every(row=>row.underlying_currency==='BTC')).toBe(true);expect(parsed.rows.map(row=>row.expiration_timestamp)).toEqual(legacy.rows.map(row=>row.expiration_timestamp));
  const reply=replySchema.parse({...optionsReply(),snapshot:parsed});
  expect(reply.snapshot).toEqual(parsed);expect(snapshotSchema.parse(parsed)).toEqual(parsed);
  const summaries=parsed.rows.map(row=>({instrument_name:row.instrument,base_currency:'BTC',quote_currency:'BTC'}));
  expect(reusableMetadata(parsed,summaries,at,'BTC')).toHaveLength(parsed.rows.length);expect(reusableMetadata(parsed,summaries,at,'ETH')).toBeNull();
  expect(visibleSnapshot(reply,at+300001)).toBeNull();
 });
 it('fails closed for malformed, extended or falsely relabeled legacy caches',()=>{
  const s=legacySnapshot();
  for(const patch of [{currency:'ETH'},{schema:'deribit-options/2'},{currencies:['BTC','ETH']},{coverage:'deribit_btc_eth_options'},{metadata_fetched_at:{BTC:iso}},{source_as_of:new Date(at-31000).toISOString()},{net_capital_flow:0},{rows:[{...s.rows[0],underlying_currency:'BTC'}]}])expect(snapshotSchema.safeParse({...s,...patch}).success).toBe(false);
  for(const key of ['volume_usd','expiration_timestamp','strike','contract_size','creation_timestamp']){
   const rows=structuredClone(s.rows);delete rows[0][key];expect(snapshotSchema.safeParse({...s,rows}).success).toBe(false);
  }
 });
});
