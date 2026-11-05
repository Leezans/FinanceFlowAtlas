import {z} from 'zod';
export const MAX_SNAPSHOT_CHARS=1_800_000;
/** Prices only: the equities feed includes ETFs. No reference dataset is redistributed. */
export type CboeTrade = {
  isin: string; tradeId: string; tradeTime: string; publicationTime: string;
  price: string | null; currency: string; notation: string; quantity: number | null;
  executionVenue: string; tradingSystem: string; publicationVenue: string;
  flags: string[]; action: 'trade' | 'cancel' | 'amend'; eligible: boolean;
  sourceFile: string | null;
};
export type CboeParseResult<T> = {rawRows: number; rejectedRows: number; skippedRows: number} & T;
/** Exact source decimal text: never pass a trade price through IEEE-754 conversion. */
export function parseCboePrice(text:string):string|null {
  return text.length<=18 && /^\d+(?:\.\d+)?$/.test(text) && /[1-9]/.test(text) ? text : null;
}
/** Normalize an ISO offset timestamp to UTC microseconds without Date's fractional truncation. */
function utcMicros(value:string,subtractMilliseconds=0):string {
  const ms=Date.parse(value);
  if(!Number.isFinite(ms))return '';
  const fraction=/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/.exec(value)?.[1]??'';
  return new Date(ms-subtractMilliseconds).toISOString().slice(0,23)+fraction.slice(3,6).padEnd(3,'0')+'Z';
}
const instant = z.string().datetime({offset:true}).refine(value => Number.isFinite(Date.parse(value))&&(/\.(\d+)/.exec(value)?.[1].length??0)<=6);
const sourceInstant = instant.refine(value=>{
  const ms=Date.parse(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)&&Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,23)===value.slice(0,23);
});
export const quoteSchema = z.object({
  isin:z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/),
  price:z.string().max(18).refine(value=>parseCboePrice(value)!==null,'invalid_price_decimal'),currency:z.string().regex(/^[A-Z]{3}$/),
  tradeId:z.string().regex(/^[A-Za-z0-9]+$/),tradeTime:sourceInstant,publicationTime:sourceInstant,
  executionVenue:z.enum(['BATE','BATD','BATP']),publicationVenue:z.literal('BATE'),
  sourceFile:z.string().regex(/^eqt_trade_BATE_\d{8}_\d{4}\.csv$/).nullable(),
}).strict().refine(row=>row.publicationTime>=row.tradeTime);
export type CboeQuote = z.infer<typeof quoteSchema>;
export const snapshotSchema = z.object({
  schema:z.literal('cboe-delayed/1'),sourceDelaySeconds:z.literal(900),
  source:z.literal('Cboe Europe BXE'),instrumentScope:z.literal('equities_and_etfs'),venueScope:z.literal('BATE/BATD/BATP'),frequency:z.literal('15_minute_delayed'),
  acquisitionStartedAt:instant,fetchedAt:instant,
  sampledFiles:z.array(z.string().regex(/^eqt_trade_BATE_\d{8}_\d{4}\.csv$/)).min(1).max(5),
  windowStart:instant,windowEnd:instant,latestPublicationTime:sourceInstant.nullable(),
  coverage:z.object({rawRows:z.number().int().nonnegative(),rejectedRows:z.number().int().nonnegative(),qualifiedRows:z.number().int().nonnegative()}).strict(),
  rows:z.array(quoteSchema).max(5000),netCapitalFlow:z.null(),
}).strict().superRefine((s,ctx)=>{
  const bad=(message:string)=>ctx.addIssue({code:'custom',message});
  if(utcMicros(s.fetchedAt)<utcMicros(s.acquisitionStartedAt))bad('fetch_time_order');
  if(Date.parse(s.windowStart)>=Date.parse(s.windowEnd))bad('window_order');
  const delayCutoff = utcMicros(s.acquisitionStartedAt,15*60_000);
  const fetchedAtMicros = utcMicros(s.fetchedAt);
  if(s.latestPublicationTime!==null&&(s.latestPublicationTime>fetchedAtMicros||s.latestPublicationTime>delayCutoff))bad('future_publication');
  if(s.latestPublicationTime!==null&&(Date.parse(s.latestPublicationTime)<Date.parse(s.windowStart)||Date.parse(s.latestPublicationTime)>=Date.parse(s.windowEnd)))bad('latest_publication_outside_window');
  if(new Set(s.sampledFiles).size!==s.sampledFiles.length)bad('duplicate_files');
  const fileStarts = new Map(s.sampledFiles.map(file => {
    const digits=file.slice('eqt_trade_BATE_'.length,-4);
    const iso=`${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}T${digits.slice(9,11)}:${digits.slice(11,13)}:00.000Z`;
    const time=Date.parse(iso);
    if(!Number.isFinite(time)||new Date(time).toISOString()!==iso)bad('invalid_file_date');
    return [file,time] as const;
  }));
  if(Date.parse(s.windowStart)!==Math.min(...fileStarts.values())||Date.parse(s.windowEnd)!==Math.max(...fileStarts.values())+60000)bad('file_window_mismatch');
  if(s.coverage.qualifiedRows<s.rows.length||s.coverage.rawRows!==s.coverage.rejectedRows+s.coverage.qualifiedRows)bad('coverage_counts');
  if(new Set(s.rows.map(row=>`${row.isin}:${row.currency}`)).size!==s.rows.length)bad('duplicate_quotes');
  for(const row of s.rows){
    if(!row.sourceFile||!s.sampledFiles.includes(row.sourceFile))bad('quote_file_not_sampled');
    const minute=row.sourceFile?fileStarts.get(row.sourceFile):undefined;
    if(minute!==undefined&&(Date.parse(row.publicationTime)<minute||Date.parse(row.publicationTime)>=minute+60000))bad('quote_file_minute_mismatch');
    if(Date.parse(row.publicationTime)<Date.parse(s.windowStart)||Date.parse(row.publicationTime)>=Date.parse(s.windowEnd)||s.latestPublicationTime===null||row.publicationTime>s.latestPublicationTime||row.publicationTime>fetchedAtMicros||row.publicationTime>delayCutoff)bad('quote_outside_window');
  }
});
export type CboeSnapshot = z.infer<typeof snapshotSchema>;
