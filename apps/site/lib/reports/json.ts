import {strictJSON} from '../ashare/strict-json';
import {ReportError} from './types';
function fail(code:string):never{throw new ReportError(code);}
export async function readJSON(response:Response,signal:AbortSignal,maxBytes:number){
 if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new ReportError('unexpected_content_type',true);
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d{1,10}$/.test(length)||Number(length)>maxBytes))fail('byte_budget');
 const reader=response.body?.getReader();if(!reader)fail('empty_response');
 const chunks:Uint8Array[]=[];let size=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{while(true){if(signal.aborted)fail('timeout');const part=await reader.read();if(signal.aborted)fail('timeout');if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)fail('byte_budget');chunks.push(part.value);}}
 finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/^\s*</.test(text))throw new ReportError('html_challenge',true);
 return strictJSON(text);
}

/** Bound fetch settlement too, including implementations that ignore AbortSignal. */
export async function boundedFetch(fetcher:typeof fetch,url:string,init:RequestInit & {signal:AbortSignal}):Promise<Response>{
 let abort=()=>{};
 const stop=new Promise<never>((_,reject)=>{abort=()=>reject(new ReportError('timeout'));init.signal.addEventListener('abort',abort,{once:true});if(init.signal.aborted)abort();});
 const work=fetcher(url,init).then(response=>{if(init.signal.aborted){void response.body?.cancel().catch(()=>{});throw new ReportError('timeout');}return response;});
 try{return await Promise.race([work,stop]);}finally{init.signal.removeEventListener('abort',abort);}
}
