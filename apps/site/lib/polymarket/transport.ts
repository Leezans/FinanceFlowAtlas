import {strictJSON} from '../ashare/strict-json';
import {PolymarketError} from './adapter';
import {SOURCE_URL,HOT_SOURCE_URL,HOT_MARKETS,PAGE_SIZE,MAX_PAGES,INTEREST_SOURCE_URL,INTEREST_MARKETS,conditionSchema} from './model';
export const MAX_BYTES=4_000_000,MAX_TOTAL_BYTES=8_000_000;
export const PAGE_INTERVAL_MS=250,COLLECTION_BUDGET_MS=8_000;
export type PolymarketCoverage={pageSizes:number[];stopReason:'source_exhausted'|'page_limit'|'time_budget';hasMore:boolean};
export type PolymarketAcquisition={rows:unknown[];coverage:PolymarketCoverage};
function fail(code:string):never{throw new PolymarketError(code);}
function retryAfter(value:string|null,now:number){if(value===null)return 0;if(/^\d+$/.test(value))return Math.min(Number.MAX_SAFE_INTEGER,Number(value)*1000);const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;}
/** Fixed official read-only URL. Redirects, denials and challenges never cause a fallback. */
async function fetchPage(url:string,fetcher:typeof fetch,signal:AbortSignal,now:()=>number,budget:{bytes:number},maxPageBytes=MAX_BYTES):Promise<unknown>{
 if(signal.aborted)fail('source_aborted');
 const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},credentials:'omit',redirect:'manual',cache:'no-store',signal});
 try{
  if([401,403,407,429,451].includes(response.status))throw new PolymarketError('source_access_denied',true);
  if(response.redirected||response.status>=300&&response.status<400)throw new PolymarketError('redirect_denied',true);
  const type=response.headers.get('content-type')??'';
  if(/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(type))throw new PolymarketError('html_challenge',true);
  if(response.status!==200)throw new PolymarketError('upstream_http',false,retryAfter(response.headers.get('retry-after'),now()));
  if(!/^application\/json(?:\s*;|$)/i.test(type))throw new PolymarketError('unexpected_content_type',true);
  const length=response.headers.get('content-length');if(length!==null&&(!/^\d{1,10}$/.test(length)||Number(length)>maxPageBytes||budget.bytes+Number(length)>MAX_TOTAL_BYTES))fail('byte_budget');
  const reader=response.body?.getReader();if(!reader)fail('empty_response');
  const chunks:Uint8Array[]=[];let size=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{while(true){if(signal.aborted)fail('timeout');const part=await reader.read();if(signal.aborted)fail('timeout');if(part.done)break;size+=part.value.byteLength;budget.bytes+=part.value.byteLength;if(size>maxPageBytes||budget.bytes>MAX_TOTAL_BYTES)fail('byte_budget');chunks.push(part.value);}}
  finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/^\s*</.test(text))throw new PolymarketError('html_challenge',true);
  return strictJSON(text);
 }finally{if(!response.body?.locked)void response.body?.cancel().catch(()=>{});}
}

function pause(signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new PolymarketError('source_aborted'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},PAGE_INTERVAL_MS);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
}
/** One lease, one fixed host/path, bounded sequential opaque-cursor traversal.
 * ID order is immutable; volume order can move markets across page boundaries.
 * Any failed/overlapping/non-monotone page invalidates the entire acquisition.
 */
export async function fetchPolymarket(fetcher:typeof fetch,signal:AbortSignal,now:()=>number):Promise<PolymarketAcquisition>{
 const started=now(),budget={bytes:0},rows:unknown[]=[],pageSizes:number[]=[],seen=new Set<string>(),cursors=new Set<string>();
 let cursor:string|undefined,previousId:bigint|undefined;
 for(let page=0;page<MAX_PAGES;page++){
  if(signal.aborted)fail('source_aborted');
  if(page>0&&now()-started>=COLLECTION_BUDGET_MS)return {rows,coverage:{pageSizes,hasMore:true,stopReason:'time_budget'}};
  const url=new URL(SOURCE_URL);if(cursor!==undefined)url.searchParams.set('after_cursor',cursor);
  const payload=await fetchPage(url.toString(),fetcher,signal,now,budget);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('invalid_page');
  const record=payload as Record<string,unknown>,values=record.markets,next=record.next_cursor;
  if(!Array.isArray(values)||values.length>PAGE_SIZE)fail('invalid_page');
  if(next!==undefined&&(typeof next!=='string'||next.length===0||next.length>2048||/[^\x21-\x7e]/.test(next)))fail('invalid_cursor');
  if(next!==undefined&&(values.length===0||cursors.has(next as string)))fail('repeated_cursor');
  for(const value of values){
   const id=value&&typeof value==='object'&&!Array.isArray(value)?(value as Record<string,unknown>).id:null;
   if(typeof id!=='string'||! /^(?:0|[1-9]\d{0,23})$/.test(id))fail('invalid_market_id');
   if(seen.has(id))fail('duplicate_market');
   const numericId=BigInt(id);if(previousId!==undefined&&numericId>=previousId)fail('unstable_page_order');
   previousId=numericId;seen.add(id);rows.push(value);
  }
  pageSizes.push(values.length);
  if(next===undefined)return {rows,coverage:{pageSizes,hasMore:false,stopReason:'source_exhausted'}};
  if(page===MAX_PAGES-1)return {rows,coverage:{pageSizes,hasMore:true,stopReason:'page_limit'}};
  if(now()-started>=COLLECTION_BUDGET_MS)return {rows,coverage:{pageSizes,hasMore:true,stopReason:'time_budget'}};
  cursor=next as string;cursors.add(cursor);await pause(signal);
 }
 throw new PolymarketError('invalid_page');
}

/** One official ranked-window request under the same lease. This is a separate
 * discovery mode, not a retry/fallback for keyset, denied access or empty data. */
export async function fetchHotPolymarket(fetcher:typeof fetch,signal:AbortSignal,now:()=>number,budget={bytes:0}):Promise<unknown[]>{
 const payload=await fetchPage(HOT_SOURCE_URL,fetcher,signal,now,budget);
 if(!Array.isArray(payload)||payload.length===0||payload.length>HOT_MARKETS)fail('invalid_market_sample');
 const seen=new Set<string>();
 for(const value of payload){
  const id=value&&typeof value==='object'&&!Array.isArray(value)?(value as Record<string,unknown>).id:null;
  if(typeof id!=='string'||! /^(?:0|[1-9]\d{0,23})$/.test(id))fail('invalid_market_id');
  if(seen.has(id))fail('duplicate_market');seen.add(id);
 }
 return payload;
}

/** One explicitly selected public OI batch. Never omit condition: omission means GLOBAL. */
export async function fetchOpenInterest(conditions:string[],fetcher:typeof fetch,signal:AbortSignal,now:()=>number,budget:{bytes:number}):Promise<unknown>{
 if(conditions.length<1||conditions.length>INTEREST_MARKETS||new Set(conditions).size!==conditions.length||conditions.some(id=>!conditionSchema.safeParse(id).success))fail('invalid_condition_selection');
 const url=new URL(INTEREST_SOURCE_URL);url.searchParams.set('condition',conditions.join(','));
 return fetchPage(url.toString(),fetcher,signal,now,budget,64_000);
}
