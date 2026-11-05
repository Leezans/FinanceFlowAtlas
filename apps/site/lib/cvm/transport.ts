/** Fixed official CVM open-data downloads. No keys, accounts, alternate hosts or redirects. */
export class CvmError extends Error {
 constructor(readonly code:string,readonly denied=false,readonly retryAfterMs=0){super(code);}
}
export function sourceSelection(at:number){
 if(!Number.isFinite(at))throw new CvmError('invalid_clock');
 const now=new Date(at),month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-2,1));
 const period=month.toISOString().slice(0,7),year=period.slice(0,4);
 if(Number(year)<2021)throw new CvmError('unsupported_period');
 return {period,cdaUrl:`https://dados.cvm.gov.br/dados/FI/DOC/CDA/DADOS/cda_fi_${period.replace('-','')}.zip`,fcaUrl:`https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_${year}.zip`};
}
function retryAfter(value:string|null,now:number){
 if(value===null)return 0;
 if(/^\d+$/.test(value))return Math.min(Number.MAX_SAFE_INTEGER,Number(value)*1000);
 const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;
}
export async function fetchArchive(url:string,maxBytes:number,signal:AbortSignal,fetcher:typeof fetch=fetch,now:()=>number=Date.now){
 if(!/^https:\/\/dados\.cvm\.gov\.br\/dados\/(?:FI\/DOC\/CDA\/DADOS\/cda_fi_\d{6}|CIA_ABERTA\/DOC\/FCA\/DADOS\/fca_cia_aberta_\d{4})\.zip$/.test(url))throw new CvmError('invalid_source_url');
 const response=await fetcher(url,{method:'GET',headers:{Accept:'application/zip, application/octet-stream'},credentials:'omit',redirect:'manual',cache:'no-store',signal});
 try{
  if([401,403,407,429,451].includes(response.status))throw new CvmError('source_access_denied',true);
  if(response.redirected||response.status>=300&&response.status<400)throw new CvmError('redirect_denied',true);
  const contentType=response.headers.get('content-type')??'';
  if(/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType))throw new CvmError('html_challenge',true);
  if(response.status!==200)throw new CvmError('upstream_http',false,retryAfter(response.headers.get('retry-after'),now()));
  if(!/^application\/(?:zip|x-zip-compressed|octet-stream)(?:\s*;|$)/i.test(contentType))throw new CvmError('unexpected_content_type',true);
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d{1,10}$/.test(length)||Number(length)>maxBytes))throw new CvmError('byte_budget');
  const reader=response.body?.getReader();if(!reader)throw new CvmError('empty_response');
  const chunks:Uint8Array[]=[];let size=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{while(true){
   if(signal.aborted)throw new CvmError('source_aborted');
   const part=await reader.read();if(signal.aborted)throw new CvmError('source_aborted');if(part.done)break;
   size+=part.value.byteLength;if(size>maxBytes)throw new CvmError('byte_budget');chunks.push(part.value);
  }}finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  // A successful response containing a login/challenge page is still a stop.
  if(data[0]!==0x50||data[1]!==0x4b||data[2]!==3||data[3]!==4){
   if(/^\s*</.test(new TextDecoder().decode(data.subarray(0,200))))throw new CvmError('html_challenge',true);
   throw new CvmError('invalid_archive');
  }
  return data;
 }finally{if(!response.body?.locked)void response.body?.cancel().catch(()=>{});}
}
