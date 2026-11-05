import {z} from 'zod';
import {strictJSON} from '../ashare/strict-json';
import {parseCboeTrades, projectCboeQuotes} from './adapter';
import {snapshotSchema,type CboeSnapshot} from './model';

export class CboeError extends Error {constructor(readonly code:string,readonly denied=false,readonly retryAfterMs=0){super(code);}}
export const MAX_FILES=5,MAX_FILE_BYTES=2_000_000,MAX_TOTAL_BYTES=10_000_000;
export const sourceUrl=(now:number)=>`https://www-api.cboe.com/europe/equities/transparency_data/get_file_map?category=equities&venue=bxe&trade_type=trade&date=${new Date(now).toISOString().slice(0,10)}`;
const file=z.object({filename:z.string(),serveUrl:z.string()}).strict();
const mapSchema=z.object({daily:z.array(file).max(20),minute:z.array(file).max(3000)}).strict();
export type CboeFile={filename:string;url:string;minuteMs:number};
/** Only exact files the official map publishes. No synthesised URL, alternate host, or daily bulk download. */
export function selectFiles(value:unknown,started:number):CboeFile[]{
 const parsed=mapSchema.safeParse(value);if(!parsed.success)throw new CboeError('invalid_file_map');
 const date=new Date(started).toISOString().slice(0,10).replaceAll('-',''),seen=new Set<string>();
 const files=parsed.data.minute.map(row=>{
  const name=/^eqt_trade_BATE_(\d{8})_(\d{2})(\d{2})\.csv$/.exec(row.filename);
  if(!name||name[1]!==date||Number(name[2])>23||Number(name[3])>59||seen.has(row.filename))throw new CboeError('invalid_file_map');
  seen.add(row.filename);
  let url:URL;try{url=new URL(row.serveUrl);}catch{throw new CboeError('invalid_file_url');}
  if(url.protocol!=='https:'||url.hostname!=='cdn.cboe.com'||url.port||url.username||url.password||url.search||url.hash||
    !new RegExp(`^/data/europe/equities/delayed_data/eqt_trade_BATE/[A-Za-z0-9_-]{1,64}/minute/${row.filename.replace('.','\\.')}$$`).test(url.pathname))throw new CboeError('invalid_file_url');
  const minuteMs=Date.parse(`${new Date(started).toISOString().slice(0,10)}T${name[2]}:${name[3]}:00Z`);
  if(minuteMs>started)throw new CboeError('future_source_file');
  return {filename:row.filename,url:url.href,minuteMs};
 });
 if(!files.length)throw new CboeError('no_published_files');
 return files.sort((a,b)=>b.minuteMs-a.minuteMs).slice(0,MAX_FILES).sort((a,b)=>a.minuteMs-b.minuteMs);
}
function retryAfter(value:string|null,now:number){if(value===null)return 0;if(/^\d+$/.test(value))return Math.min(Number.MAX_SAFE_INTEGER,Number(value)*1000);const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;}
async function requestText(fetcher:typeof fetch,url:string,accept:string,limit:number,signal:AbortSignal,now:()=>number):Promise<{text:string;bytes:number}>{
 if(signal.aborted)throw new CboeError('source_aborted');
 const response=await fetcher(url,{method:'GET',headers:{Accept:accept},credentials:'omit',redirect:'manual',cache:'no-store',signal});
 try{
  if([401,403,406,407,429,451].includes(response.status))throw new CboeError('source_access_denied',true);
  if(response.redirected||response.status>=300&&response.status<400)throw new CboeError('redirect_denied',true);
  const contentType=response.headers.get('content-type')??'';
  if(/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType))throw new CboeError('html_challenge',true);
  if(response.status!==200)throw new CboeError('upstream_http',false,retryAfter(response.headers.get('retry-after'),now()));
  if(!(accept==='application/json'?/^application\/json(?:\s*;|$)/i:/^(?:text\/csv|application\/csv|application\/octet-stream|text\/plain)(?:\s*;|$)/i).test(contentType))throw new CboeError('unexpected_content_type');
  const length=response.headers.get('content-length');if(length!==null&&(!/^\d{1,10}$/.test(length)||Number(length)>limit))throw new CboeError('byte_budget');
  const reader=response.body?.getReader();if(!reader)throw new CboeError('empty_response');
  const chunks:Uint8Array[]=[];let bytes=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{while(true){if(signal.aborted)throw new CboeError('source_aborted');const part=await reader.read();if(signal.aborted)throw new CboeError('source_aborted');if(part.done)break;bytes+=part.value.byteLength;if(bytes>limit)throw new CboeError('byte_budget');chunks.push(part.value);}}
  finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
  const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(all);if(/^\s*</.test(text))throw new CboeError('html_challenge',true);
  return {text,bytes};
 }finally{if(!response.body?.locked)void response.body?.cancel().catch(()=>{});}
}
export async function fetchCboeSnapshot(fetcher:typeof fetch,started:number,now:()=>number,signal:AbortSignal):Promise<CboeSnapshot>{
 const map=await requestText(fetcher,sourceUrl(started),'application/json',1_000_000,signal,now);
 const files=selectFiles(strictJSON(map.text),started);
 const delayCutoff = new Date(started-15*60_000).toISOString().replace('Z','000Z');
 let used=0;const events:ReturnType<typeof parseCboeTrades>['events']=[];let rawRows=0,rejectedRows=0;
 // Five bounded sequential reads at most. One shared gate owns the whole cohort.
 for(const f of files){
  const response=await requestText(fetcher,f.url,'text/csv',Math.min(MAX_FILE_BYTES,MAX_TOTAL_BYTES-used),signal,now);used+=response.bytes;
  const parsed=parseCboeTrades(response.text,f.filename);
  if(parsed.rejectedRows)throw new CboeError('invalid_source_rows');
  rawRows+=parsed.rawRows;rejectedRows+=parsed.events.filter(event=>!event.eligible).length;
  for(const event of parsed.events){
   const publication=Date.parse(event.publicationTime);
   if(publication<f.minuteMs||publication>=f.minuteMs+60_000||event.publicationTime>delayCutoff)throw new CboeError('inconsistent_source_time');
   events.push(event);
  }
 }
 const rows=projectCboeQuotes(events),fetchedAt=new Date(now()).toISOString();
 const latestPublicationTime=events.reduce<string|null>((latest,row)=>!latest||row.publicationTime>latest?row.publicationTime:latest,null);
 return snapshotSchema.parse({schema:'cboe-delayed/1',source:'Cboe Europe BXE',sourceDelaySeconds:900,instrumentScope:'equities_and_etfs',venueScope:'BATE/BATD/BATP',frequency:'15_minute_delayed',acquisitionStartedAt:new Date(started).toISOString(),fetchedAt,
  sampledFiles:files.map(f=>f.filename),windowStart:new Date(files[0].minuteMs).toISOString(),windowEnd:new Date(files.at(-1)!.minuteMs+60_000).toISOString(),latestPublicationTime,
  coverage:{rawRows,rejectedRows,qualifiedRows:events.filter(event=>event.eligible).length},rows,netCapitalFlow:null});
}
