import {z} from 'zod';
import {MAX_SOURCE_THOUSANDS,PARTICIPANTS,PRODUCTS,snapshotSchema,type TaifexSnapshot} from './model';
export const TAIFEX_URL='https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfCallsAndPutsBytheDate';
export const TAIFEX_DATASET='https://data.gov.tw/dataset/11600';
export const TAIFEX_LICENSE='https://data.gov.tw/license';
export class TaifexError extends Error {constructor(readonly code:string,readonly denied=false,readonly retryAfterMs=0){super(code);}}
const fail=(code:string):never=>{throw new TaifexError(code);};
// Reject coercions, whitespace, exponent notation, signed zero, separators,
// leading zeroes and unsafe integers before scaling any monetary value.
const unsigned=z.string().max(16).regex(/^(0|[1-9]\d*)$/).refine(value=>Number.isSafeInteger(Number(value)));
const signed=z.string().max(17).regex(/^(0|-?[1-9]\d*)$/).refine(value=>Number.isSafeInteger(Number(value)));
const thousands=unsigned.refine(value=>Number(value)<=MAX_SOURCE_THOUSANDS);
const signedThousands=signed.refine(value=>Math.abs(Number(value))<=MAX_SOURCE_THOUSANDS);
const sourceRowSchema=z.object({
 Date:z.string().regex(/^\d{8}$/),ContractCode:z.enum(['臺指選擇權','電子選擇權','金融選擇權','股票選擇權','ETF選擇權']),
 CallPut:z.enum(['CALL','PUT']),Item:z.enum(['自營商','投信','外資及陸資']),
 'TradingVolume(Long)':unsigned,'TradingValue(Long)(Thousands)':thousands,
 'TradingVolume(Short)':unsigned,'TradingValue(Short)(Thousands)':thousands,
 'TradingVolume(Net)':signed,'TradingValue(Net)(Thousands)':signedThousands,
 'OpenInterest(Long)':unsigned,'ContractValueofOpenInterest(Long)(Thousands)':thousands,
 'OpenInterest(Short)':unsigned,'ContractValueofOpenInterest(Short)(Thousands)':thousands,
 'OpenInterest(Net)':signed,'ContractValueofOpenInterest(Net)(Thousands)':signedThousands,
}).strict();
const payloadSchema=z.array(sourceRowSchema).length(30);
export function parseTaifex(payload:unknown,startedISO:string,fetchedISO:string):TaifexSnapshot{
 const parsed=payloadSchema.safeParse(payload);
 if(!parsed.success)return fail('invalid_source_schema');
 const raw=parsed.data,date=raw[0].Date;
 if(raw.some(row=>row.Date!==date))return fail('mixed_report_dates');
 const rows=raw.map(row=>{
  const product=PRODUCTS.find(product=>product.label===row.ContractCode)!.id;
  const participant=PARTICIPANTS.find(participant=>participant.label===row.Item)!.id;
  const option_type=row.CallPut==='CALL'?'call' as const:'put' as const;
  return {
   id:`${product}/${option_type}/${participant}`,product,option_type,participant,
   buy_contracts:Number(row['TradingVolume(Long)']),sell_contracts:Number(row['TradingVolume(Short)']),net_contracts:Number(row['TradingVolume(Net)']),
   buy_amount:Number(row['TradingValue(Long)(Thousands)'])*1000,sell_amount:Number(row['TradingValue(Short)(Thousands)'])*1000,reported_net_amount:Number(row['TradingValue(Net)(Thousands)'])*1000,
   long_oi_contracts:Number(row['OpenInterest(Long)']),short_oi_contracts:Number(row['OpenInterest(Short)']),net_oi_contracts:Number(row['OpenInterest(Net)']),
   long_oi_amount:Number(row['ContractValueofOpenInterest(Long)(Thousands)'])*1000,short_oi_amount:Number(row['ContractValueofOpenInterest(Short)(Thousands)'])*1000,reported_net_oi_amount:Number(row['ContractValueofOpenInterest(Net)(Thousands)'])*1000,
  };
 });
 // TWD is established by official product definitions and stock/ETF premium
 // turnover documentation. This endpoint has no currency field. The amounts
 // are premium values, not underlying exposure and not inferred from counts.
 const snapshot=snapshotSchema.safeParse({
  schema:'taifex-options-institutions/1',source:'TAIFEX',currency:'TWD',source_unit:'thousand_TWD',frequency:'daily',
  report_date:`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,source_released_at:null,
  acquisition_started_at:startedISO,fetched_at:fetchedISO,net_capital_flow:null,rows,
 });
 if(!snapshot.success)return fail('invalid_snapshot');
 return snapshot.data;
}
