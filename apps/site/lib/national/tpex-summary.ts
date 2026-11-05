/** Official TPEx daily monetary institutional trading summary, not national capital flow. */
import {z} from 'zod';

export const TPEX_SUMMARY_URL='https://www.tpex.org.tw/openapi/v1/tpex_3insti_summary';
export const TPEX_SUMMARY_DATASET='https://data.gov.tw/dataset/11743';
export const TPEX_SUMMARY_LICENSE='https://data.gov.tw/license';
export const TPEX_SUMMARY_SCOPE='TPEx reported OTC securities; not all Taiwan markets or listed companies only';
export const TPEX_SUMMARY_PARTICIPANTS=['foreign','trust','dealer','total'] as const;
export type TpexSummaryParticipant=typeof TPEX_SUMMARY_PARTICIPANTS[number];
const MAX_AMOUNT=999_999_999_999_999;
const unsigned=z.number().int().safe().min(0).max(MAX_AMOUNT);
const signed=z.number().int().safe().min(-MAX_AMOUNT).max(MAX_AMOUNT);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>
 Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
const instant=z.string().datetime({offset:true});
const moneySchema=z.object({buy:unsigned,sell:unsigned,net:signed}).strict()
 .refine(value=>value.buy-value.sell===value.net);
const participantSchema=z.object({id:z.enum(TPEX_SUMMARY_PARTICIPANTS),buy:unsigned,sell:unsigned,net:signed}).strict()
 .refine(value=>value.buy-value.sell===value.net);
type Money=z.infer<typeof moneySchema>;

export const tpexSummarySnapshotSchema=z.object({
 schema:z.literal('tpex-institutional-money/1'),source:z.literal('TPEx'),
 market:z.literal('Taiwan_OTC'),unit:z.literal('TWD'),
 report_date:day,source_released_at:z.null(),acquisition_started_at:instant,fetched_at:instant,
 net_capital_flow:z.null(),participants:z.array(participantSchema).length(4),
}).strict().refine(snapshot=>{
 const participants=new Map(snapshot.participants.map(participant=>[participant.id,participant]));
 if(participants.size!==4||!TPEX_SUMMARY_PARTICIPANTS.every(id=>participants.has(id)))return false;
 const total=participants.get('total')!;
 for(const field of ['buy','sell','net'] as const){
  if(['foreign','trust','dealer'].reduce((sum,id)=>sum+participants.get(id as TpexSummaryParticipant)![field],0)!==total[field])return false;
 }
 return Date.parse(snapshot.fetched_at)>=Date.parse(snapshot.acquisition_started_at)
  &&snapshot.report_date<=new Date(Date.parse(snapshot.acquisition_started_at)+8*3_600_000).toISOString().slice(0,10);
});
export type TpexSummarySnapshot=z.infer<typeof tpexSummarySnapshotSchema>;
export class TpexSummaryError extends Error{constructor(readonly code:string){super(code);}}
function fail(code:string):never{throw new TpexSummaryError(code);}

function rocDate(value:unknown):string{
 if(typeof value!=='string'||!/^\d{7}$/.test(value))fail('invalid_report_date');
 const result=`${Number(value.slice(0,3))+1911}-${value.slice(3,5)}-${value.slice(5,7)}`;
 if(!day.safeParse(result).success)fail('invalid_report_date');
 return result;
}
function amount(value:unknown):number{
 if(typeof value!=='string'||! /^-?(?:0|[1-9]\d{0,14})$/.test(value))fail('invalid_amount');
 const result=Number(value);
 if(!Number.isSafeInteger(result)||Math.abs(result)>MAX_AMOUNT)fail('invalid_amount');
 return result;
}
// The first foreign line includes foreign dealers. Those dealers also belong to the
// dealer line. Use the explicitly excluding-dealers row for the three-party sum.
const NAMES={
 foreignAll:'外資及陸資合計',foreign:'外資及陸資(不含自營商)',foreignDealer:'外資自營商',
 trust:'投信',dealer:'自營商合計',dealerProprietary:'自營商(自行買賣)',
 dealerHedge:'自營商(避險)',total:'三大法人合計*',
} as const;
const knownNames=new Set<string>(Object.values(NAMES));

/** Parsing only: this module never fetches, redirects, retries or resets source gates. */
export function parseTpexSummary(payload:unknown,acquisitionStartedAt:string,fetchedAt:string):TpexSummarySnapshot{
 if(!Array.isArray(payload)||payload.length!==knownNames.size)fail('invalid_row_count');
 const rows=new Map<string,Money>(),dates=new Set<string>();
 for(const item of payload){
  if(!item||typeof item!=='object'||Array.isArray(item))fail('invalid_schema');
  const raw=item as Record<string,unknown>;
  if(typeof raw.Investor!=='string'||raw.Investor.length>100)fail('invalid_investor');
  const name=raw.Investor.trim();
  if(!knownNames.has(name))fail('unknown_investor');
  if(rows.has(name))fail('duplicate_investor');
  dates.add(rocDate(raw.Date));
  const parsed=moneySchema.safeParse({buy:amount(raw.PurchaseAmount),sell:amount(raw.SaleAmount),net:amount(raw.Net)});
  if(!parsed.success)fail('invalid_money_balance');
  rows.set(name,parsed.data);
 }
 if(dates.size!==1)fail('report_date_mismatch');
 if(rows.size!==knownNames.size)fail('missing_investor');
 const get=(name:string)=>rows.get(name)!;
 const equalsSum=(whole:string,parts:string[])=>['buy','sell','net'].every(field=>
  get(whole)[field as keyof Money]===parts.reduce((sum,name)=>sum+get(name)[field as keyof Money],0));
 if(!equalsSum(NAMES.foreignAll,[NAMES.foreign,NAMES.foreignDealer])
  ||!equalsSum(NAMES.dealer,[NAMES.dealerProprietary,NAMES.dealerHedge])
  ||!equalsSum(NAMES.total,[NAMES.foreign,NAMES.trust,NAMES.dealer]))fail('invalid_summary_balance');
 const result=tpexSummarySnapshotSchema.safeParse({
  schema:'tpex-institutional-money/1',source:'TPEx',market:'Taiwan_OTC',unit:'TWD',
  report_date:[...dates][0],source_released_at:null,acquisition_started_at:acquisitionStartedAt,
  fetched_at:fetchedAt,net_capital_flow:null,
  participants:TPEX_SUMMARY_PARTICIPANTS.map(id=>({id,...get(NAMES[id])})),
 });
 if(!result.success)fail('invalid_snapshot');
 return result.data;
}
