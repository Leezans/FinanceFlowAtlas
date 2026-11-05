/** Sina's legacy money-flow endpoint, never an Eastmoney f62 substitute.
 * This module does not enable itself, run timers, or persist market observations.
 */
import {strictJSON} from '../ashare/strict-json';
export const SINA_SOURCE = {
  provider: 'sina',
  page: 'https://vip.stock.finance.sina.com.cn/moneyflow/',
  methodology: 'https://finance.sina.com.cn/temp/guest4377.shtml',
  terms: 'https://corp.sina.com.cn/chn/copyright.html',
  metric_id: 'sina_net_active_flow',
  classification: 'sina_industry_fenlei_0',
} as const;
const BASE = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/';
export const COUNT_URL = `${BASE}MoneyFlow.ssc_bkzj_bk?fenlei=0`;
export const RANK_URL = `${BASE}MoneyFlow.ssl_bkzj_bk?page=1&num=100&sort=netamount&asc=0&fenlei=0`;
export const REFRESH_MS = 300_000;
const MAX_BYTES = 262_144, MAX_ROWS = 100, INTERVAL = 3_000, DEADLINE = 30_000;
const API = '/api/v1/ashare/sina/';
export type SinaOutcome = {kind: 'success'|'temporary_failure'|'denied'; retryAfterMs?: number};
export interface SinaGate {
  acquire(scope: string, signal?: AbortSignal): Promise<{token: string}>;
  release(token: string, outcome: SinaOutcome): Promise<void>;
}
export type SinaIndustry = {
  id: string; name: string;
  inflow_cny: string|null; outflow_cny: string|null; net_flow_cny: string|null;
  net_flow_ratio: string|null; average_price_cny: string|null; average_return_ratio: string|null;
  quality_flags: ('missing_flow'|'missing_ratio'|'missing_price'|'zero_price')[];
};
export type SinaSnapshot = {
  schema: 'sina-industry-evidence/1'; source: typeof SINA_SOURCE; rows: SinaIndustry[];
  source_total: number; page_count: 1; fetched_at: string; acquisition_started_at: string;
  source_observed_at: null; trade_date: null; delay_status: 'not_provided';
  unit: 'CNY'; monetary_encoding: 'decimal_string'; ratio_unit: 'fraction';
  coverage: 'provider_industry_list'; completeness: 'one_page_count_checked_before_after';
  classification_exclusivity: 'not_established'; notice: string;
};
class SinaError extends Error {
  constructor(readonly code: string, readonly denied = false, readonly retryAfterMs = 0) {super(code);}
}
function fail(code: string): never {throw new SinaError(code);}
// Decimal strings are retained exactly. Arithmetic uses fixed-scale integers,
// not binary floats. This limit is a transport/schema bound, not a market claim.
function decimal(value: unknown): string|null {
  if(value === null) return null;
  if(typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,10})?$/.test(value)) fail('invalid_decimal');
  return value;
}
function scaled(value: string): bigint {
  const negative=value.startsWith('-'), [whole, fraction='']=value.replace(/^-/, '').split('.');
  const magnitude=BigInt(whole)*BigInt('10000000000')+BigInt(fraction.padEnd(10,'0'));
  return negative ? -magnitude : magnitude;
}
export function parseSinaCount(value: unknown): number {
  if(typeof value !== 'string' || !/^[1-9]\d{0,2}$/.test(value)) fail('invalid_count');
  const count=Number(value);
  if(count>MAX_ROWS) fail('atomic_page_limit');
  return count;
}
export function parseSinaIndustries(payload: unknown, count: number): SinaIndustry[] {
  if(!Number.isInteger(count)||count<1||count>MAX_ROWS) fail('invalid_count');
  if(!Array.isArray(payload)||payload.length!==count) fail('incomplete_snapshot');
  const ids=new Set<string>();
  return payload.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value)) fail('invalid_row');
    const r=value as Record<string,unknown>;
    if(r.cate_type!=='0'||typeof r.category!=='string'||!/^new_[a-z0-9_]{1,64}$/.test(r.category)) fail('invalid_industry_id');
    const id=`0/${r.category}`;
    if(ids.has(id)) fail('duplicate_id');
    ids.add(id);
    if(typeof r.name!=='string'||!r.name.trim()||r.name.length>128||/[\u0000-\u001f\u007f]/.test(r.name)) fail('invalid_name');
    const inflow=decimal(r.inamount), outflow=decimal(r.outamount), net=decimal(r.netamount);
    const ratio=decimal(r.ratioamount), price=decimal(r.avg_price), change=decimal(r.avg_changeratio);
    if(inflow!==null&&scaled(inflow)<BigInt(0)||outflow!==null&&scaled(outflow)<BigInt(0)||price!==null&&scaled(price)<BigInt(0)) fail('negative_unsigned_value');
    if(change!==null&&scaled(change)<-BigInt('10000000000')) fail('invalid_return');
    if(inflow!==null&&outflow!==null&&net!==null&&scaled(inflow)-scaled(outflow)!==scaled(net)) fail('flow_arithmetic_mismatch');
    const quality_flags:SinaIndustry['quality_flags']=[];
    if(inflow===null||outflow===null||net===null) quality_flags.push('missing_flow');
    if(ratio===null) quality_flags.push('missing_ratio');
    if(price===null) quality_flags.push('missing_price');
    else if(scaled(price)===BigInt(0)) quality_flags.push('zero_price');
    return {id,name:r.name,inflow_cny:inflow,outflow_cny:outflow,net_flow_cny:net,net_flow_ratio:ratio,average_price_cny:price,average_return_ratio:change,quality_flags};
  }).sort((a,b)=>a.id.localeCompare(b.id,'en'));
}
function abortCheck(signal: AbortSignal) {if(signal.aborted) fail('aborted');}
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve,reject)=>{
    abortCheck(signal);
    const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);};
    const cancel=()=>{done();reject(new SinaError('aborted'));};
    const timer=setTimeout(()=>{done();resolve();},ms);
    signal.addEventListener('abort',cancel,{once:true});
  });
}
function settleGate<T>(operation: Promise<T>,signal: AbortSignal): Promise<T> {
  let cancel=()=>{};
  const timeout=new Promise<never>((_resolve,reject)=>{
    cancel=()=>reject(new SinaError('source_gate_outcome_unconfirmed',true));
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted)cancel();
  });
  // If the DB outcome is uncertain, stop locally. Never reset or take over the
  // persistent busy/blocked row. The original operation is not retried.
  return Promise.race([operation,timeout]).finally(()=>signal.removeEventListener('abort',cancel));
}
function retryAfter(value: string|null): number {
  if(value===null)return 0;
  // An unrepresentably large delay fails closed instead of shortening it.
  if(/^\d+$/.test(value))return Math.min(Number.MAX_SAFE_INTEGER,Number(value)*1000);
  const date=Date.parse(value);
  return Number.isFinite(date)?Math.max(0,date-Date.now()):0;
}
async function readJSON(response: Response,budget: number,signal: AbortSignal): Promise<{payload: unknown; bytes: number}> {
  const contentType=response.headers.get('content-type')??'';
  if(!/^application\/json(?:\s*;|$)/i.test(contentType))throw new SinaError('unexpected_content_type',true);
  const charset=contentType.match(/charset\s*=\s*"?([^;"\s]+)/i)?.[1].toLowerCase()??'utf-8';
  if(!['utf-8','utf8','gbk','gb2312'].includes(charset))fail('unsupported_charset');
  const encoding=response.headers.get('content-encoding')?.trim().toLowerCase();
  if(encoding&&!['identity','gzip','br'].includes(encoding))fail('unsupported_content_encoding');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d{1,12}$/.test(length)||Number(length)>budget))fail('byte_budget');
  const reader=response.body?.getReader();if(!reader)fail('empty_response');
  const chunks:Uint8Array[]=[];let size=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try {
    while(true){abortCheck(signal);const part=await reader.read();abortCheck(signal);if(part.done)break;if(part.value.length>budget-size)fail('byte_budget');size+=part.value.length;chunks.push(part.value);}
  } finally {signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  // Workers native fetch already decompresses. Do not decompress again.
  const decoded=new TextDecoder(charset,{fatal:true}).decode(bytes);
  if(/^\s*</.test(decoded))throw new SinaError('html_challenge',true);
  return {payload:strictJSON(decoded),bytes:size};
}
type Fetcher=(url: string,init: RequestInit)=>Promise<Response>;
type State={snapshot?: SinaSnapshot; published: number; retryAt: number; failures: number; denied: boolean; error?: string; pending?: Promise<void>};
const stateKey=Symbol.for('FinanceFlowAtlas.sina.industry.v1');
const globals=globalThis as typeof globalThis&{[stateKey]?: State};
const fresh=():State=>({published:0,retryAt:0,failures:0,denied:false});
/** Only an explicitly enabled owner-only host may acquire; status never fetches. */
export function createSinaIndustryHandler(options: {enabled?: ()=>boolean; sourceGate?: SinaGate; fetcher?: Fetcher; runtime?: 'cloudflare-workers'; isolatedForTests?: boolean; now?: ()=>number}={}) {
  const state=options.isolatedForTests?fresh():(globals[stateKey]??=fresh());
  const now=options.now??(()=>performance.now());
  const fetcher=options.fetcher??((url,init)=>fetch(url,init));
  const enabled=()=>{try{return options.enabled?.()===true;}catch{return false;}};
  function routingAllowed(){
    if(options.isolatedForTests&&options.fetcher)return true;
    if(options.runtime!=='cloudflare-workers')return false;
    const environment=(globalThis as typeof globalThis&{process?:{env?:Record<string,string|undefined>}}).process?.env;
    return !environment||!['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].some(key=>!!environment[key]);
  }
  async function refresh(requestSignal: AbortSignal){
    const controller=new AbortController();const abort=()=>controller.abort();
    requestSignal.addEventListener('abort',abort,{once:true});if(requestSignal.aborted)abort();
    const timer=setTimeout(abort,DEADLINE),signal=controller.signal;
    let lease:{token:string}|undefined, candidate:SinaSnapshot|undefined, failure:unknown, released=false;
    try {
      if(!enabled())fail('disabled');if(!routingAllowed())fail('runtime_routing_unverified');
      if(!options.sourceGate)fail('source_gate_required');
      abortCheck(signal);
      lease=await settleGate(options.sourceGate.acquire('sina:industry:0',signal),signal);
      if(!lease?.token||typeof lease.token!=='string')throw new SinaError('invalid_source_lease',true);
      let used=0,lastRequest=-Infinity;
      const started=new Date().toISOString();
      const get=async(url: string)=>{
        abortCheck(signal);if(!enabled())fail('disabled');
        const delay=INTERVAL-(now()-lastRequest);if(delay>0)await sleep(delay,signal);
        abortCheck(signal);if(!enabled())fail('disabled');
        lastRequest=now();
        const response=await fetcher(url,{method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',headers:{Accept:'application/json'},signal});
        try {
          if([401,403,407,429,451].includes(response.status))throw new SinaError('source_access_denied',true);
          if(response.redirected||response.status>=300&&response.status<400)throw new SinaError('redirect_denied',true);
          if(/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new SinaError('html_challenge',true);
          if(response.status!==200)throw new SinaError('upstream_http',false,retryAfter(response.headers.get('retry-after')));
          const result=await readJSON(response,MAX_BYTES-used,signal);used+=result.bytes;
          return result.payload;
        } finally {if(!response.body?.locked)void response.body?.cancel().catch(()=>{});}
      };
      try {
        const count=parseSinaCount(await get(COUNT_URL));
        const rows=parseSinaIndustries(await get(RANK_URL),count);
        const finalCount=parseSinaCount(await get(COUNT_URL));
        if(count!==finalCount)fail('unstable_count');
        abortCheck(signal);if(!enabled())fail('disabled');
        candidate={schema:'sina-industry-evidence/1',source:SINA_SOURCE,rows,source_total:count,page_count:1,fetched_at:new Date().toISOString(),acquisition_started_at:started,source_observed_at:null,trade_date:null,delay_status:'not_provided',unit:'CNY',monetary_encoding:'decimal_string',ratio_unit:'fraction',coverage:'provider_industry_list',completeness:'one_page_count_checked_before_after',classification_exclusivity:'not_established',notice:'新浪主动交易分类净额代理，不是东财主力净额，也不是市场新增资金。分类覆盖与排他性未证实；抓取时间不代表行情时间。'};
      }catch(error){failure=error;}
      const outcome:SinaOutcome=failure instanceof SinaError&&failure.denied?{kind:'denied'}:failure?{kind:'temporary_failure',retryAfterMs:failure instanceof SinaError?failure.retryAfterMs:0}:{kind:'success'};
      try {await settleGate(options.sourceGate.release(lease.token,outcome),signal);released=true;}
      catch {throw new SinaError('source_gate_release_unconfirmed',true);}
      if(failure)throw failure;
      if(!candidate)fail('missing_snapshot');
      abortCheck(signal);if(!enabled())fail('disabled');
      state.snapshot=candidate;state.published=now();state.failures=0;state.error=undefined;state.retryAt=0;
    }catch(error){
      const code=error instanceof SinaError?error.code:error&&typeof error==='object'&&'code'in error&&['source_busy','source_cooldown','source_denied','source_gate_unavailable','source_aborted'].includes(String(error.code))?String(error.code):error instanceof SyntaxError?'invalid_json':'collection_failed';
      state.error=code;state.failures++;
      if(error instanceof SinaError&&error.denied||code==='source_denied'||lease&&!released)state.denied=true;
      const backoff=Math.max(Math.min(1_800_000,REFRESH_MS*2**Math.min(state.failures-1,3)),error instanceof SinaError?error.retryAfterMs:0);
      state.retryAt=state.denied?Infinity:now()+backoff;
    }finally{clearTimeout(timer);requestSignal.removeEventListener('abort',abort);controller.abort();}
  }
  function reply(status: number,payload?: unknown,etag?: string){
    const headers:Record<string,string>={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
    if(etag)headers.ETag=etag;if(status===503&&!state.denied)headers['Retry-After']=String(Math.max(300,Math.ceil((state.retryAt-now())/1000)||300));
    return new Response(payload===undefined?null:JSON.stringify(payload),{status,headers});
  }
  return async(request: Request):Promise<Response>=>{
    if(request.method!=='GET')return reply(405,{error:'method_not_allowed'});
    const url=new URL(request.url);
    if(![`${API}snapshot`,`${API}status`].includes(url.pathname))return reply(404,{error:'not_found'});
    if(url.search)return reply(400,{error:'unsupported_query'});
    if(!enabled())return reply(403,{state:'source_use_review_pending',source:SINA_SOURCE,message:'新浪候选尚未启用。公开访问不等于已确认站外使用范围；目前不会采集或返回缓存数据。'});
    const stale=()=>!!state.snapshot&&(state.denied||!!state.error||now()-state.published>=REFRESH_MS);
    if(url.pathname.endsWith('/status'))return reply(200,{state:state.snapshot?'ready':'unavailable',source:SINA_SOURCE,refreshing:!!state.pending,stale:stale(),has_error:!!state.error,refresh_interval_seconds:300,acquisition_is_separate:false,...(state.error?{error_code:state.error}:{})});
    if(!state.denied&&now()>=state.retryAt&&(!state.snapshot||now()-state.published>=REFRESH_MS)&&!state.pending)state.pending=refresh(request.signal).finally(()=>{state.pending=undefined;});
    if(state.pending)await state.pending;
    if(!enabled())return reply(403,{state:'source_use_review_pending'});
    if(!state.snapshot)return reply(503,{state:'unavailable',source:SINA_SOURCE,error_code:state.error??'not_yet_acquired'});
    const payload={...state.snapshot,stale:stale(),has_error:!!state.error,...(state.error?{error_code:state.error}:{})};
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
    const etag='"'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')+'"';
    return request.headers.get('if-none-match')===etag?reply(304,undefined,etag):reply(200,payload,etag);
  };
}
