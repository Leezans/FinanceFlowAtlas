import {MAX_ROWS,METADATA_MAX_AGE_MS,snapshotSchema,type OptionsSnapshot,type OptionRow} from './model';
export const SUMMARY_URL='https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option';
export const INSTRUMENTS_URL='https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false';
export class OptionsError extends Error {constructor(readonly code:string,readonly denied=false,readonly retryAfterMs=0){super(code);}}
const fail=(code:string):never=>{throw new OptionsError(code);};
const object=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:fail('invalid_schema');
export function resultRows(payload:unknown):Record<string,unknown>[] {
 const raw=object(payload);
 if(raw.error){const e=object(raw.error);if(e.code===10028||e.code===10000||e.code===13009||e.code===13004||e.code===13021)throw new OptionsError('source_access_denied',true);fail('source_api_error');}
 if(raw.jsonrpc!=='2.0'||raw.testnet!==false||!Array.isArray(raw.result)||raw.result.length<1||raw.result.length>MAX_ROWS)return fail('invalid_source_envelope');
 const rows=raw.result.map(object),names=rows.map(r=>r.instrument_name);
 if(names.some(n=>typeof n!=='string')||new Set(names).size!==names.length)fail('duplicate_or_invalid_instrument');return rows;
}
export type OptionMetadata=Pick<OptionRow,'instrument'|'expiration_timestamp'|'strike'|'option_type'|'contract_size'>;
export function parseMetadata(payload:unknown):OptionMetadata[]{
 return resultRows(payload).map(r=>{
  if(r.kind!=='option'||r.base_currency!=='BTC'||r.quote_currency!=='BTC'||r.settlement_currency!=='BTC'||r.is_active!==true||
   !['call','put'].includes(String(r.option_type))||typeof r.instrument_name!=='string'||typeof r.expiration_timestamp!=='number'||typeof r.strike!=='number'||typeof r.contract_size!=='number')fail('unexpected_option_metadata');
  return {instrument:r.instrument_name as string,expiration_timestamp:r.expiration_timestamp as number,strike:r.strike as number,option_type:r.option_type as 'call'|'put',contract_size:r.contract_size as number};
 });
}
export function reusableMetadata(previous:OptionsSnapshot|null,summaries:Record<string,unknown>[],at:number):OptionMetadata[]|null{
 if(!previous||at-Date.parse(previous.metadata_fetched_at)>METADATA_MAX_AGE_MS)return null;
 const live=previous.rows.filter(r=>r.expiration_timestamp>at),names=new Set(live.map(r=>r.instrument));
 return names.size===summaries.length&&summaries.every(r=>names.has(String(r.instrument_name)))?live:null;
}
export function parseSummary(summaries:Record<string,unknown>[],metadata:OptionMetadata[],started:string,fetched:string,metadataFetched:string):OptionsSnapshot {
 const map=new Map(metadata.filter(r=>r.expiration_timestamp>Date.parse(started)).map(r=>[r.instrument,r]));
 if(map.size!==metadata.length||map.size!==summaries.length)fail('option_universe_changed');
 const rows=summaries.map(r=>{
  const meta=map.get(String(r.instrument_name));if(!meta||r.base_currency!=='BTC'||r.quote_currency!=='BTC')fail('unexpected_option');
  // A missing source change remains unknown. Never compute it from last/mark or fill it with zero.
  return {...meta,creation_timestamp:r.creation_timestamp,mark_price:r.mark_price,mark_iv:r.mark_iv,price_change:r.price_change??null,
   bid_price:r.bid_price,ask_price:r.ask_price,last:r.last,volume:r.volume,volume_usd:r.volume_usd,open_interest:r.open_interest};
 });
 const sourceTime=Math.min(...rows.map(r=>typeof r.creation_timestamp==='number'?r.creation_timestamp:NaN));
 if(!Number.isFinite(sourceTime)||sourceTime<0||sourceTime>8.64e15)fail('invalid_source_timestamp');
 const parsed=snapshotSchema.safeParse({schema:'deribit-btc-options/1',source:'Deribit',currency:'BTC',coverage:'deribit_btc_options',
  acquisition_started_at:started,fetched_at:fetched,source_as_of:new Date(sourceTime).toISOString(),metadata_fetched_at:metadataFetched,
  net_capital_flow:null,delay_policy:'source_delay_unconfirmed',rows});
 if(!parsed.success)return fail('invalid_snapshot');return parsed.data;
}
