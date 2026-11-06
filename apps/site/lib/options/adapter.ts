import {z} from 'zod';
import {MAX_ROWS,METADATA_MAX_AGE_MS,OPTION_CURRENCIES,coverageForCurrencies,snapshotSchema,type OptionCurrency,type OptionsSnapshot,type OptionRow} from './model';
export const SUMMARY_URLS={
 BTC:'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option',
 ETH:'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=ETH&kind=option',
} as const;
export const INSTRUMENTS_URLS={
 BTC:'https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false',
 ETH:'https://www.deribit.com/api/v2/public/get_instruments?currency=ETH&kind=option&expired=false',
} as const;
export const SUMMARY_URL=SUMMARY_URLS.BTC,INSTRUMENTS_URL=INSTRUMENTS_URLS.BTC;
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
export type OptionMetadata=Pick<OptionRow,'instrument'|'underlying_currency'|'expiration_timestamp'|'strike'|'option_type'|'contract_size'>;
const metadataSchema=z.object({
 instrument:z.string().regex(/^(BTC|ETH)-[1-9]\d?[A-Z]{3}\d{2}-\d+(?:\.\d+)?-[CP]$/),underlying_currency:z.enum(OPTION_CURRENCIES),
 expiration_timestamp:z.number().int().safe().min(0).max(8.64e15),strike:z.number().finite().positive().max(1e15),
 option_type:z.enum(['call','put']),contract_size:z.number().finite().positive().max(1e15),
}).strict().refine(r=>{
 // Validate source fields first; the instrument name is only a consistency check.
 const [currency,date,strike,side]=r.instrument.split('-');
 const expiry=new Date(r.expiration_timestamp),months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
 const expiryDate=`${expiry.getUTCDate()}${months[expiry.getUTCMonth()]}${String(expiry.getUTCFullYear()).slice(-2)}`;
 return currency===r.underlying_currency&&Number(strike)===r.strike&&date===expiryDate&&side===(r.option_type==='call'?'C':'P');
},'option_metadata_identity');
export function parseMetadata(payload:unknown,currency:OptionCurrency='BTC'):OptionMetadata[]{
 return resultRows(payload).map(r=>{
  if(r.kind!=='option'||r.base_currency!==currency||r.quote_currency!==currency||r.settlement_currency!==currency||r.counter_currency!=='USD'||r.is_active!==true)fail('unexpected_option_metadata');
  const parsed=metadataSchema.safeParse({instrument:r.instrument_name,underlying_currency:r.base_currency,expiration_timestamp:r.expiration_timestamp,strike:r.strike,option_type:r.option_type,contract_size:r.contract_size});
  if(!parsed.success)return fail('unexpected_option_metadata');return parsed.data;
 });
}
export function reusableMetadata(previous:OptionsSnapshot|null,summaries:Record<string,unknown>[],at:number,currency:OptionCurrency='BTC'):OptionMetadata[]|null{
 const metadataFetched=previous?.metadata_fetched_at[currency],age=metadataFetched===undefined?NaN:at-Date.parse(metadataFetched);
 if(!previous||!previous.currencies.includes(currency)||!Number.isFinite(age)||age<0||age>METADATA_MAX_AGE_MS)return null;
 const live=previous.rows.filter(r=>r.underlying_currency===currency&&r.expiration_timestamp>at),names=new Set(live.map(r=>r.instrument));
 return names.size===summaries.length&&summaries.every(r=>r.base_currency===currency&&r.quote_currency===currency&&names.has(String(r.instrument_name)))?live:null;
}
export function parseSummary(summaries:Record<string,unknown>[],metadata:OptionMetadata[],started:string,fetched:string,metadataFetched:string,currency:OptionCurrency='BTC'):OptionsSnapshot {
 const map=new Map(metadata.filter(r=>r.underlying_currency===currency&&r.expiration_timestamp>Date.parse(started)).map(r=>[r.instrument,r]));
 if(map.size!==metadata.length||map.size!==summaries.length||!summaries.length||summaries.length>MAX_ROWS)fail('option_universe_changed');
 const rows=summaries.map(r=>{
  const meta=map.get(String(r.instrument_name));if(!meta||r.base_currency!==currency||r.quote_currency!==currency)fail('unexpected_option');
  // A missing source change remains unknown. Never compute it from last/mark or fill it with zero.
  return {...meta,creation_timestamp:r.creation_timestamp,mark_price:r.mark_price,mark_iv:r.mark_iv,price_change:r.price_change??null,
   bid_price:r.bid_price,ask_price:r.ask_price,last:r.last,volume:r.volume,volume_usd:r.volume_usd,open_interest:r.open_interest};
 });
 const sourceTime=Math.min(...rows.map(r=>typeof r.creation_timestamp==='number'?r.creation_timestamp:NaN));
 if(!Number.isFinite(sourceTime)||sourceTime<0||sourceTime>8.64e15)fail('invalid_source_timestamp');
 const parsed=snapshotSchema.safeParse({schema:'deribit-options/2',source:'Deribit',currencies:[currency],coverage:coverageForCurrencies([currency]),
  acquisition_started_at:started,fetched_at:fetched,source_as_of:new Date(sourceTime).toISOString(),metadata_fetched_at:{[currency]:metadataFetched},
  net_capital_flow:null,delay_policy:'source_delay_unconfirmed',rows});
 if(!parsed.success)return fail('invalid_snapshot');return parsed.data;
}
/** Atomic full coverage only: a missing currency never becomes a successful combined refresh. */
export function combineSnapshots(parts:OptionsSnapshot[]):OptionsSnapshot {
 if(parts.length!==2)fail('incomplete_option_coverage');
 const validated=parts.map(part=>{const parsed=snapshotSchema.safeParse(part);if(!parsed.success)return fail('invalid_snapshot');return parsed.data;});
 if(validated.some(part=>part.currencies.length!==1)||new Set(validated.map(part=>part.currencies[0])).size!==2)fail('incomplete_option_coverage');
 if(validated[0].acquisition_started_at!==validated[1].acquisition_started_at)fail('incoherent_option_acquisition');
 const ordered=OPTION_CURRENCIES.map(currency=>validated.find(part=>part.currencies[0]===currency)??fail('incomplete_option_coverage'));
 const parsed=snapshotSchema.safeParse({
  schema:'deribit-options/2',source:'Deribit',currencies:[...OPTION_CURRENCIES],coverage:'deribit_btc_eth_options',
  acquisition_started_at:ordered[0].acquisition_started_at,
  fetched_at:ordered.reduce((a,b)=>Date.parse(a.fetched_at)>=Date.parse(b.fetched_at)?a:b).fetched_at,
  source_as_of:ordered.reduce((a,b)=>Date.parse(a.source_as_of)<=Date.parse(b.source_as_of)?a:b).source_as_of,
  metadata_fetched_at:Object.assign({},...ordered.map(part=>part.metadata_fetched_at)),
  net_capital_flow:null,delay_policy:'source_delay_unconfirmed',rows:ordered.flatMap(part=>part.rows),
 });
 if(!parsed.success)return fail('invalid_combined_snapshot');return parsed.data;
}
