import {z} from 'zod';
import {MAX_SOURCE_THOUSANDS,MAX_SOURCE_PRODUCTS,MAX_SOURCE_ROWS,PARTICIPANTS,PRODUCTS,balancesValid,snapshotSchema,type FuturesSnapshot} from './model';
export const FUTURES_URL='https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate';
export const FUTURES_DATASET='https://data.gov.tw/dataset/11596';
export const FUTURES_LICENSE='https://data.gov.tw/license';
export class FuturesError extends Error {constructor(readonly code:string,readonly denied=false,readonly retryAfterMs=0){super(code);}}
const fail=(code:string):never=>{throw new FuturesError(code);};
// Reject coercions, whitespace, exponent notation, signed zero, separators,
// leading zeroes and unsafe integers before scaling any monetary value.
const unsigned=z.string().max(16).regex(/^(0|[1-9]\d*)$/).refine(value=>Number.isSafeInteger(Number(value)));
const signed=z.string().max(17).regex(/^(0|-?[1-9]\d*)$/).refine(value=>Number.isSafeInteger(Number(value)));
const thousands=unsigned.refine(value=>Number(value)<=MAX_SOURCE_THOUSANDS);
const signedThousands=signed.refine(value=>Math.abs(Number(value))<=MAX_SOURCE_THOUSANDS);
const sourceRowSchema=z.object({
 Date:z.string().regex(/^\d{8}$/),ContractCode:z.string().min(1).max(80).refine(value=>value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value)),Item:z.enum(['自營商','投信','外資及陸資']),
 'TradingVolume(Long)':unsigned,'TradingValue(Long)(Thousands)':thousands,
 'TradingVolume(Short)':unsigned,'TradingValue(Short)(Thousands)':thousands,
 'TradingVolume(Net)':signed,'TradingValue(Net)(Thousands)':signedThousands,
 'OpenInterest(Long)':unsigned,'ContractValueofOpenInterest(Long)(Thousands)':thousands,
 'OpenInterest(Short)':unsigned,'ContractValueofOpenInterest(Short)(Thousands)':thousands,
 'OpenInterest(Net)':signed,'ContractValueofOpenInterest(Net)(Thousands)':signedThousands,
}).strict();
const payloadSchema=z.array(sourceRowSchema).min(3).max(MAX_SOURCE_ROWS);
export function parseFutures(payload:unknown,startedISO:string,fetchedISO:string):FuturesSnapshot{
 const parsed=payloadSchema.safeParse(payload);
 if(!parsed.success)return fail('invalid_source_schema');
 const raw=parsed.data,date=raw[0].Date,groups=new Map<string,Set<string>>();
 if(raw.some(row=>row.Date!==date))return fail('mixed_report_dates');
 const converted=raw.map(row=>{
  const participants=groups.get(row.ContractCode)??new Set<string>();
  if(participants.has(row.Item))return fail('invalid_source_coverage');
  participants.add(row.Item);groups.set(row.ContractCode,participants);
  const numeric={
   buy_contracts:Number(row['TradingVolume(Long)']),sell_contracts:Number(row['TradingVolume(Short)']),net_contracts:Number(row['TradingVolume(Net)']),
   buy_amount:Number(row['TradingValue(Long)(Thousands)'])*1000,sell_amount:Number(row['TradingValue(Short)(Thousands)'])*1000,reported_net_amount:Number(row['TradingValue(Net)(Thousands)'])*1000,
   long_oi_contracts:Number(row['OpenInterest(Long)']),short_oi_contracts:Number(row['OpenInterest(Short)']),net_oi_contracts:Number(row['OpenInterest(Net)']),
   long_oi_amount:Number(row['ContractValueofOpenInterest(Long)(Thousands)'])*1000,short_oi_amount:Number(row['ContractValueofOpenInterest(Short)(Thousands)'])*1000,reported_net_oi_amount:Number(row['ContractValueofOpenInterest(Net)(Thousands)'])*1000,
  };
  if(!balancesValid(numeric))return fail('invalid_source_balance');
  return {label:row.ContractCode,participant:PARTICIPANTS.find(participant=>participant.label===row.Item)!.id,numeric};
 });
 if(groups.size>MAX_SOURCE_PRODUCTS||[...groups.values()].some(participants=>participants.size!==PARTICIPANTS.length))return fail('invalid_source_coverage');
 const covered=PRODUCTS.filter(product=>groups.has(product.label));
 if(!covered.length)return fail('unsupported_products');
 // Only products with independently verified TWD definitions are admitted.
 // New/unknown groups remain excluded, not silently denominated or zero-filled.
 const rows=converted.flatMap(row=>{
  const product=covered.find(product=>product.label===row.label);
  return product?[{id:`${product.id}/${row.participant}`,product:product.id,participant:row.participant,...row.numeric}]:[];
 });
 const excluded=groups.size-covered.length;
 const snapshot=snapshotSchema.safeParse({
  schema:'taifex-futures-institutions/1',source:'TAIFEX',currency:'TWD',source_unit:'thousand_TWD',frequency:'daily',metric:'contract_notional_turnover',
  report_date:`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,source_released_at:null,
  acquisition_started_at:startedISO,fetched_at:fetchedISO,net_capital_flow:null,
  source_product_count:groups.size,excluded_product_count:excluded,excluded_row_count:excluded*PARTICIPANTS.length,covered_products:covered.map(product=>product.id),rows,
 });
 if(!snapshot.success)return fail('invalid_snapshot');
 return snapshot.data;
}
