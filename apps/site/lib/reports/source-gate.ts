import {SourceGateError,type GateD1,type D1Result} from '../ashare/source-gate';
import {strictJSON} from '../ashare/strict-json';
import type {ReportGate,ReportOutcome,ReportPublication} from './types';
function validDeadline(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
export interface ReportGateConfig<T> {sql:{acquire:string;inspect:string;finish:string};validate:(raw:unknown)=>T;refreshMs:number;providerRequired?:boolean}
/** SQL must be static trusted application code, never request input. Busy and denied leases never expire. */
export class D1ReportGate<T> implements ReportGate<T>{
 constructor(private readonly db:GateD1,private readonly config:ReportGateConfig<T>){}
 private async run(sql:string,...values:unknown[]):Promise<D1Result>{try{const result=await this.db.prepare(sql).bind(...values).run();if(!result.success)throw new Error();return result;}catch{throw new SourceGateError('source_gate_unavailable');}}
 async inspect(){
  const row=(await this.run(this.config.sql.inspect)).results?.[0];
  if(row&&(row.status==='blocked'||this.config.providerRequired&&row.provider_status==='blocked'))return {state:'blocked' as const,retryAt:0,snapshot:null};
  if(!row||!['idle','busy','blocked'].includes(String(row.status))||typeof row.not_before_ms!=='number'||!Number.isSafeInteger(row.not_before_ms)||row.not_before_ms<0)throw new SourceGateError('source_gate_unavailable');
  const state=row.status as 'idle'|'busy'|'blocked';let snapshot:T|null=null;
  if(this.config.providerRequired){
   if(!['idle','busy','blocked'].includes(String(row.provider_status)))throw new SourceGateError('source_gate_unavailable');
   if(!validDeadline(row.provider_not_before_ms)||!validDeadline(row.now_ms))throw new SourceGateError('source_gate_unavailable');
   const retryAt=Math.max(row.not_before_ms,row.provider_not_before_ms);
   if(row.provider_status==='busy')return {state:'busy' as const,retryAt,snapshot:null,providerUnavailable:true,providerError:'source_busy' as const};
   if(row.provider_not_before_ms>row.now_ms)return {state:'idle' as const,retryAt,snapshot:null,providerUnavailable:true,providerError:'source_cooldown' as const};
  }
  if(state!=='blocked'&&row.payload!==null){
   try{if(typeof row.payload!=='string'||row.payload.length>2_000_000)throw new Error();snapshot=this.config.validate(strictJSON(row.payload));}
   catch{throw new SourceGateError('source_gate_unavailable');}
  }
  return {state,retryAt:row.not_before_ms,snapshot};
 }
 async acquire(signal?:AbortSignal){
  if(signal?.aborted)throw new SourceGateError('source_aborted');
  const token=crypto.randomUUID(),result=await this.run(this.config.sql.acquire,token);
  if(result.meta?.changes===1){if(signal?.aborted){await this.release(token,{kind:'temporary_failure'});throw new SourceGateError('source_aborted');}return {token};}
  if(result.meta?.changes!==0)throw new SourceGateError('source_gate_unavailable');
  const row=(await this.run(this.config.sql.inspect)).results?.[0];
  if(row?.status==='blocked'||this.config.providerRequired&&row?.provider_status==='blocked')throw new SourceGateError('source_denied');
  if(this.config.providerRequired){
   if(!validDeadline(row?.provider_not_before_ms)||!validDeadline(row?.now_ms))throw new SourceGateError('source_gate_unavailable');
   if(row?.provider_status==='busy')throw new SourceGateError('source_busy');
   if(row?.provider_status!=='idle')throw new SourceGateError('source_gate_unavailable');
   if(row.provider_not_before_ms>row.now_ms)throw new SourceGateError('source_cooldown');
  }
  if(row?.status==='blocked')throw new SourceGateError('source_denied');
  if(row?.status==='busy')throw new SourceGateError('source_busy');
  if(row?.status==='idle'&&typeof row.now_ms==='number'&&typeof row.not_before_ms==='number'&&row.not_before_ms>row.now_ms)throw new SourceGateError('source_cooldown');
  throw new SourceGateError('source_gate_unavailable');
 }
 async release(token:string,outcome:ReportOutcome<T>):Promise<void|ReportPublication>{
  const delay=Math.max(this.config.refreshMs,outcome.retryAfterMs??0);
  if(!token||!['success','temporary_failure','denied'].includes(outcome.kind)||!Number.isSafeInteger(delay)||delay<0)throw new SourceGateError('source_gate_unavailable');
  let payload:string|null=null;
  if(outcome.kind==='success'){
   try{payload=JSON.stringify(this.config.validate(outcome.snapshot));}catch{throw new SourceGateError('source_gate_unavailable');}
   if(payload.length>2_000_000)throw new SourceGateError('source_gate_unavailable');
  }else if(outcome.snapshot)throw new SourceGateError('source_gate_unavailable');
  const result=await this.run(this.config.sql.finish,outcome.kind==='denied'?'blocked':'idle',delay,outcome.kind==='denied'?1:0,payload,token);
  if(result.meta?.changes===0)throw new SourceGateError('source_stale_lease');if(result.meta?.changes!==1)throw new SourceGateError('source_gate_unavailable');
  if(this.config.providerRequired&&outcome.kind==='success'){
   // The atomic finish settled our lease even if publication was suppressed.
   // Do not throw an uncertain-release error or retry this completed write.
   const row=result.results?.[0];
   if(row?.status==='blocked'||row?.provider_status==='blocked')return {published:false,error_code:'source_denied'};
   if(!row||row.status!=='idle'||!validDeadline(row.provider_not_before_ms)||!validDeadline(row.now_ms))return {published:false,error_code:'source_gate_unavailable'};
   if(row.provider_status==='busy')return {published:false,error_code:'source_busy'};
   if(row.provider_status!=='idle')return {published:false,error_code:'source_gate_unavailable'};
   if(row.provider_not_before_ms>row.now_ms)return {published:false,error_code:'source_cooldown'};
   return {published:true};
  }
 }
}
