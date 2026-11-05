/** Public spot evidence from one exchange. No accounts, orders or net-flow model. */
import {strictJSON} from '../ashare/strict-json';
export const KRAKEN_URL='https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD';
export const KRAKEN_DOCS='https://docs.kraken.com/api-reference/market-data/get-ticker-information';
export const REFRESH_MS=60_000, MAX_CACHE_AGE_MS=900_000;
const MAX_BYTES=32_768, DEADLINE_MS=12_000;
export type KrakenRow={pair:'BTC/USD'|'ETH/USD';base:'BTC'|'ETH';quote:'USD';last_price_usd:string;volume_base_24h:string;vwap_usd_24h:string;trades_24h:number;net_capital_flow:null;open_interest:null};
export type KrakenSnapshot={schema:'kraken-spot/1';venue:'Kraken';coverage:'two_selected_spot_pairs_one_venue';rows:KrakenRow[];acquisition_started_at:string;fetched_at:string;source_observed_at:null;delay_status:'not_provided';window:'rolling_24h';monetary_encoding:'decimal_string'};
export type KrakenStatus={state:'available'|'stale'|'unavailable'|'denied';error_code:string|null;last_attempt_at:string|null;fetched_at:string|null;cache_age_ms:number|null;refresh_ms:number;max_cache_age_ms:number;next_retry_at:string|null};
export type KrakenReply={status:KrakenStatus;snapshot:KrakenSnapshot|null};
export type KrakenOutcome={kind:'success'|'temporary_failure'|'denied';retryAfterMs?:number};
export interface KrakenGate {inspect():Promise<'idle'|'busy'|'blocked'>;acquire(signal?:AbortSignal):Promise<{token:string}>;release(token:string,outcome:KrakenOutcome):Promise<void>}
export class KrakenError extends Error {constructor(readonly code:string,readonly denied=false,readonly retryAfterMs=0){super(code);}}
function fail(code:string):never{throw new KrakenError(code);}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_schema');return value as Record<string,unknown>;}
function decimal(value:unknown,positive=false):string{
 if(typeof value!=='string'||! /^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/.test(value)||positive&&!/[1-9]/.test(value))fail('invalid_decimal');
 return value;
}
function field(row:Record<string,unknown>,key:string,index:number):unknown{const values=row[key];if(!Array.isArray(values)||values.length!==2)fail('invalid_schema');return values[index];}
/** Use v[1]/p[1]/t[1], not the UTC-today element. Never calculate flow from trades. */
export function parseKrakenTicker(payload:unknown,started:string,fetched:string):KrakenSnapshot{
 const root=object(payload);if(!Array.isArray(root.error)||root.error.some(e=>typeof e!=='string'))fail('invalid_schema');
 if(root.error.length){
  if(root.error.some(e=>/rate limit|throttl|permission|denied|unavailable in|restricted/i.test(e)))throw new KrakenError('source_access_denied',true);
  fail('source_api_error');
 }
 const result=object(root.result),keys=Object.keys(result).sort();
 if(keys.join(',')!=='XETHZUSD,XXBTZUSD')fail('incomplete_pair_set');
 const rows=([['XXBTZUSD','BTC'],['XETHZUSD','ETH']] as const).map(([key,base]):KrakenRow=>{
  const row=object(result[key]);const trades=field(row,'t',1);
  if(typeof trades!=='number'||!Number.isSafeInteger(trades)||trades<0)fail('invalid_trade_count');
  return {pair:`${base}/USD`,base,quote:'USD',last_price_usd:decimal(field(row,'c',0),true),volume_base_24h:decimal(field(row,'v',1)),vwap_usd_24h:decimal(field(row,'p',1),true),trades_24h:trades,net_capital_flow:null,open_interest:null};
 });
 if(!Number.isFinite(Date.parse(started))||!Number.isFinite(Date.parse(fetched))||Date.parse(fetched)<Date.parse(started))fail('invalid_clock');
 return {schema:'kraken-spot/1',venue:'Kraken',coverage:'two_selected_spot_pairs_one_venue',rows,acquisition_started_at:started,fetched_at:fetched,source_observed_at:null,delay_status:'not_provided',window:'rolling_24h',monetary_encoding:'decimal_string'};
}
async function readJSON(response:Response,signal:AbortSignal){
 if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new KrakenError('unexpected_content_type',true);
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d{1,10}$/.test(length)||Number(length)>MAX_BYTES))fail('byte_budget');
 const reader=response.body?.getReader();if(!reader)fail('empty_response');
 const chunks:Uint8Array[]=[];let size=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{while(true){if(signal.aborted)fail('timeout');const part=await reader.read();if(signal.aborted)fail('timeout');if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES)fail('byte_budget');chunks.push(part.value);}}
 finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/^\s*</.test(text))throw new KrakenError('html_challenge',true);
 return strictJSON(text);
}
function settleGate<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 let cancel=()=>{};
 const deadline=new Promise<never>((_resolve,reject)=>{cancel=()=>reject(new KrakenError('source_gate_outcome_unconfirmed',true));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
 // A late/uncertain DB result is never taken over or retried.
 return Promise.race([operation,deadline]).finally(()=>signal.removeEventListener('abort',cancel));
}
function retryAfter(value:string|null,now:number){if(value===null)return 0;if(/^\d+$/.test(value))return Math.min(Number.MAX_SAFE_INTEGER,Number(value)*1000);const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;}
export function createKrakenHandler(options:{gate:KrakenGate;fetcher?:typeof fetch;now?:()=>number;waitUntil?:(promise:Promise<unknown>)=>void;isolatedForTests?:boolean}){
 const now=options.now??Date.now,fetcher=options.fetcher??fetch;
 let snapshot:KrakenSnapshot|null=null,pending:Promise<void>|undefined,error:string|null=null,denied=false,lastAttempt:number|null=null,retryAt=0,failures=0;
 async function refresh(requestSignal:AbortSignal,lifetimeReady:()=>boolean,track:<T>(operation:Promise<T>)=>Promise<T>){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),DEADLINE_MS);let token:string|undefined,releasing=false;
  const abort=()=>controller.abort();requestSignal.addEventListener('abort',abort,{once:true});if(requestSignal.aborted)abort();
  const abortCheck=()=>{if(controller.signal.aborted)fail(requestSignal.aborted?'aborted':'timeout');};
  const started=now();lastAttempt=started;
  try{
   if(!lifetimeReady())fail('runtime_lifetime_unverified');
   abortCheck();
   const lease=await settleGate(track(options.gate.acquire(controller.signal)),controller.signal);token=lease.token;
   if(!token)fail('source_gate_unavailable');abortCheck();
   const response=await fetcher(KRAKEN_URL,{method:'GET',headers:{Accept:'application/json'},credentials:'omit',redirect:'manual',cache:'no-store',signal:controller.signal});
   let candidate:KrakenSnapshot;
   try{
    if([401,403,407,429,451].includes(response.status))throw new KrakenError('source_access_denied',true);
    if(response.redirected||response.status>=300&&response.status<400)throw new KrakenError('redirect_denied',true);
    if(/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new KrakenError('html_challenge',true);
    if(response.status!==200)throw new KrakenError('upstream_http',false,retryAfter(response.headers.get('retry-after'),now()));
    candidate=parseKrakenTicker(await readJSON(response,controller.signal),new Date(started).toISOString(),new Date(now()).toISOString());
   }finally{if(!response.body?.locked)void response.body?.cancel().catch(()=>{});}
   abortCheck();
   // Cleanup has its own budget: request cancellation must not interrupt the
   // single owner-token release, or publish a candidate before it is confirmed.
   releasing=true;await settleGate(track(options.gate.release(token,{kind:'success'})),AbortSignal.timeout(2_000));token=undefined;releasing=false;
   abortCheck();
   snapshot=candidate;error=null;failures=0;retryAt=now()+REFRESH_MS;
  }catch(caught){
   const code=caught instanceof KrakenError?(caught.code==='timeout'&&requestSignal.aborted?'aborted':caught.code):typeof (caught as {code?:unknown})?.code==='string'?(caught as {code:string}).code:controller.signal.aborted?(requestSignal.aborted?'aborted':'timeout'):'source_unavailable';
   denied=denied||(caught instanceof KrakenError&&caught.denied)||code==='source_denied';error=code;
   failures++;const pause=Math.max(Math.min(REFRESH_MS*2**Math.min(failures-1,4),MAX_CACHE_AGE_MS),caught instanceof KrakenError?caught.retryAfterMs:0);
   retryAt=now()+pause;
   if(token&&!releasing){
    try{await settleGate(track(options.gate.release(token,{kind:denied?'denied':'temporary_failure',retryAfterMs:pause})),AbortSignal.timeout(2_000));}
    catch{denied=true;error='source_gate_outcome_unconfirmed';}
   }else if(releasing){denied=true;error='source_gate_outcome_unconfirmed';}
   if(denied)snapshot=null;
  }finally{clearTimeout(timer);requestSignal.removeEventListener('abort',abort);controller.abort();}
 }
 function retainedRequest<T>(run:(lifetimeReady:()=>boolean,track:<Value>(operation:Promise<Value>)=>Promise<Value>)=>Promise<T>):Promise<T>{
  let retained=options.isolatedForTests===true&&!options.waitUntil;
  const operations:Promise<unknown>[]=[];
  const track=<T>(operation:Promise<T>)=>{operations.push(operation);return operation;};
  // Defer admission until registration succeeds. Retain actual DB mutations
  // too: a bounded wait can finish before D1 confirms its result. Late acquire
  // cleanup stays inside D1KrakenGate and never starts a provider request.
  const work=Promise.resolve().then(()=>run(()=>retained,track));
  const lifetime=work.finally(async()=>{await Promise.allSettled(operations);});
  try{if(options.waitUntil){options.waitUntil(lifetime);retained=true;}}catch{/* No acquisition without retained cleanup. */}
  return work;
 }
 function reply():KrakenReply{
  const at=now(),age=snapshot?at-Date.parse(snapshot.fetched_at):null;
  const valid=age!==null&&age>=0&&age<=MAX_CACHE_AGE_MS;
  return {snapshot:!denied&&valid?snapshot:null,status:{state:denied?'denied':!valid?'unavailable':error||age!>REFRESH_MS?'stale':'available',error_code:error,last_attempt_at:lastAttempt===null?null:new Date(lastAttempt).toISOString(),fetched_at:snapshot?.fetched_at??null,cache_age_ms:age,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:denied||retryAt===0||retryAt>8.64e15?null:new Date(retryAt).toISOString()}};
 }
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url),mode=url.pathname.split('/').at(-1);
  if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers:{Allow:'GET'}});
  if(!['snapshot','status'].includes(mode??'')||url.search)return Response.json({error:'invalid_request'},{status:400});
  const run=async(lifetimeReady:()=>boolean,track:<T>(operation:Promise<T>)=>Promise<T>)=>{
  try{if(await settleGate(options.gate.inspect(),AbortSignal.timeout(2_000))==='blocked'){denied=true;snapshot=null;error='source_denied';}}
  catch{error='source_gate_unavailable';const status={...reply().status,state:'unavailable'};return Response.json(mode==='status'?status:{status,snapshot:null},{status:503,headers:{'Cache-Control':'no-store'}});}
  if(mode==='snapshot'&&!denied&&now()>=retryAt){pending??=refresh(request.signal,lifetimeReady,track).finally(()=>{pending=undefined;});await pending;}
  const result=reply();return Response.json(mode==='status'?result.status:result,{status:mode==='status'||result.snapshot?200:503,headers:{'Cache-Control':'no-store','X-Data-Status':result.status.state}});
  };
  // Register before even the first asynchronous inspection, so an early
  // response/disconnect cannot end the request before cleanup is retained.
  return mode==='snapshot'?retainedRequest(run):run(()=>false,operation=>operation);
 };
}
