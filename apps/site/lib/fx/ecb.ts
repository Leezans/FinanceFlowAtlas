import {SaxesParser,type SaxesTagNS} from 'saxes';
import {ECB_URL,MAX_SOURCE_BYTES,fxSnapshotSchema,type FxErrorCode,type FxSnapshot} from './model';

export class FxSourceError extends Error{
 constructor(readonly code:FxErrorCode){super(code)}
}
const GESMES='http://www.gesmes.org/xml/2002-08-01';
const ECB='http://www.ecb.int/vocabulary/2002-08-01/eurofxref';
const invalid=():never=>{throw new FxSourceError('invalid_source')};
/** Parse a bounded, namespace-aware ECB daily document. Never resolve DTDs/entities. */
export function parseEcb(xml:string,retrievedAt:string):FxSnapshot{
 if(new TextEncoder().encode(xml).byteLength>MAX_SOURCE_BYTES)invalid();
 const parser=new SaxesParser({xmlns:true}),stack:SaxesTagNS[]=[],rates:FxSnapshot['rates']=[];
 let referenceDate='',subject='',sender='',outerCount=0,subjectCount=0,senderCount=0,nameCount=0,datedCount=0;
 parser.on('doctype',invalid);parser.on('processinginstruction',invalid);parser.on('cdata',invalid);parser.on('error',invalid);
 parser.on('opentag',tag=>{
  const path=stack.map(t=>t.local).join('/');
  const attrs=Object.values(tag.attributes).filter(a=>a.uri!=='http://www.w3.org/2000/xmlns/');
  const keys=attrs.map(a=>a.name).sort().join(',');
  if(path===''&&tag.local==='Envelope'&&tag.uri===GESMES&&keys===''){}
  else if(path==='Envelope'&&tag.local==='subject'&&tag.uri===GESMES&&keys===''&&++subjectCount===1){}
  else if(path==='Envelope'&&tag.local==='Sender'&&tag.uri===GESMES&&keys===''&&++senderCount===1){}
  else if(path==='Envelope/Sender'&&tag.local==='name'&&tag.uri===GESMES&&keys===''&&++nameCount===1){}
  else if(path==='Envelope'&&tag.local==='Cube'&&tag.uri===ECB&&keys===''&&++outerCount===1){}
  else if(path==='Envelope/Cube'&&tag.local==='Cube'&&tag.uri===ECB&&keys==='time'&&++datedCount===1){referenceDate=tag.attributes.time.value}
  else if(path==='Envelope/Cube/Cube'&&tag.local==='Cube'&&tag.uri===ECB&&keys==='currency,rate'){
   rates.push({currency:tag.attributes.currency.value,per_eur:tag.attributes.rate.value});if(rates.length>64)invalid();
  }else invalid();
  stack.push(tag);
 });
 parser.on('closetag',()=>{stack.pop()});
 parser.on('text',text=>{
  const path=stack.map(t=>t.local).join('/');
  if(path==='Envelope/subject')subject+=text;
  else if(path==='Envelope/Sender/name')sender+=text;
  else if(text.trim())invalid();
 });
 try{
  parser.write(xml).close();
  if(subject.trim()!=='Reference rates'||sender.trim()!=='European Central Bank'||outerCount!==1)invalid();
  return fxSnapshotSchema.parse({schema:'ecb-fx-reference/1',concept:'exchange_rate_reference',base_currency:'EUR',reference_date:referenceDate,retrieved_at:retrievedAt,rates:rates.sort((a,b)=>a.currency.localeCompare(b.currency))});
 }catch{throw new FxSourceError('invalid_source')}
}
async function readBounded(response:Response){
 if(Number(response.headers.get('content-length'))>MAX_SOURCE_BYTES||!response.body)invalid();
 const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_SOURCE_BYTES){await reader.cancel();invalid()}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{return invalid()}
}
export async function fetchEcb(fetcher:typeof fetch,now:()=>number):Promise<FxSnapshot>{
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12_000);
 try{
  const response=await fetcher(ECB_URL,{redirect:'manual',signal:controller.signal,headers:{Accept:'application/xml, text/xml'},cache:'no-store'});
  // Never follow login/challenge/redirect routes or rotate hosts after a denial.
  if(response.redirected||[301,302,303,307,308,401,403,407,429,451].includes(response.status))throw new FxSourceError('source_stopped');
  const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(type==='text/html'||type==='application/xhtml+xml')throw new FxSourceError('source_stopped');
  if(!response.ok)throw new FxSourceError('source_unavailable');
  if(type!=='text/xml'&&type!=='application/xml')throw new FxSourceError('invalid_source');
  const xml=await readBounded(response);
  return parseEcb(xml,new Date(now()).toISOString());
 }catch(error){if(error instanceof FxSourceError)throw error;throw new FxSourceError('network_error')}
 finally{clearTimeout(timeout)}
}
