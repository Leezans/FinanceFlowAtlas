import {strictJSON} from '../ashare/strict-json';
import {PolymarketError} from './adapter';
import {SOURCE_URL} from './model';
export const MAX_BYTES=4_000_000;
function fail(code:string):never{throw new PolymarketError(code);}
function retryAfter(value:string|null,now:number){if(value===null)return 0;if(/^\d+$/.test(value))return Math.min(Number.MAX_SAFE_INTEGER,Number(value)*1000);const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;}
/** Fixed official read-only URL. Redirects, denials and challenges never cause a fallback. */
export async function fetchPolymarket(fetcher:typeof fetch,signal:AbortSignal,now:()=>number):Promise<unknown>{
 const response=await fetcher(SOURCE_URL,{method:'GET',headers:{Accept:'application/json'},credentials:'omit',redirect:'manual',cache:'no-store',signal});
 try{
  if([401,403,407,429,451].includes(response.status))throw new PolymarketError('source_access_denied',true);
  if(response.redirected||response.status>=300&&response.status<400)throw new PolymarketError('redirect_denied',true);
  const type=response.headers.get('content-type')??'';
  if(/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(type))throw new PolymarketError('html_challenge',true);
  if(response.status!==200)throw new PolymarketError('upstream_http',false,retryAfter(response.headers.get('retry-after'),now()));
  if(!/^application\/json(?:\s*;|$)/i.test(type))throw new PolymarketError('unexpected_content_type',true);
  const length=response.headers.get('content-length');if(length!==null&&(!/^\d{1,10}$/.test(length)||Number(length)>MAX_BYTES))fail('byte_budget');
  const reader=response.body?.getReader();if(!reader)fail('empty_response');
  const chunks:Uint8Array[]=[];let size=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{while(true){if(signal.aborted)fail('timeout');const part=await reader.read();if(signal.aborted)fail('timeout');if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES)fail('byte_budget');chunks.push(part.value);}}
  finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/^\s*</.test(text))throw new PolymarketError('html_challenge',true);
  return strictJSON(text);
 }finally{if(!response.body?.locked)void response.body?.cancel().catch(()=>{});}
}
