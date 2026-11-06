import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runSchedulerTick} from '../scheduler/runner';
import {configuredScopes, type Claim, type Finish, type SchedulerStore} from '../scheduler/state';

function fixture() {
  const claim=vi.fn(async()=>({code:'claimed',claim:{scope:'level1',token:'job'}})),finish=vi.fn<(claim:Claim,result:Finish)=>Promise<void>>(async()=>{});
  const request=vi.fn(async()=>new Response(JSON.stringify({error_code:'source_cooldown'}),{status:503,
    headers:{'X-Ashare-Error-Code':'source_cooldown','X-Ashare-Recovery':'retry','Retry-After':'900'}}));
  return {claim,finish,request,store:{claim,finish} as unknown as SchedulerStore};
}
const tick=(f:ReturnType<typeof fixture>,overrides:Record<string,unknown>={})=>runSchedulerTick({enabled:'true',scopes:'level1',scheduledTime:Date.now(),store:f.store,request:f.request,...overrides});
afterEach(()=>vi.useRealTimers());
describe('optional unattended adapter',()=>{
 it('is disabled without exact opt-in and does not even read storage',async()=>{
  for(const enabled of [undefined,'false','TRUE',true,'']){const f=fixture();expect((await tick(f,{enabled})).code).toBe('scheduler_disabled');expect(f.claim).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();}
 });
 it('validates a bounded, canonical scope list without discovery or duplicates',()=>{
  expect(configuredScopes('level1,BK0001')).toEqual(['BK0001','level1']);
  for(const value of ['',undefined,'level1,','level1,level1','BK1',' level1','https://example.com','BK0001,BK0002,BK0003,BK0004,BK0005,BK0006,BK0007,BK0008,BK0009'])expect(()=>configuredScopes(value)).toThrow();
 });
 it('leaves rejected admission and every source gate untouched',async()=>{
  const f=fixture();f.claim.mockResolvedValue({code:'scheduler_busy'} as never);
  expect((await tick(f)).code).toBe('scheduler_busy');expect(f.request).not.toHaveBeenCalled();expect(f.finish).not.toHaveBeenCalled();
 });
 it('does not fast-continue busy/cooldown/invalid responses',async()=>{
  for(const code of ['source_busy','source_cooldown','invalid_schema']){
   const f=fixture();f.request.mockResolvedValue(new Response(JSON.stringify({error_code:code}),{status:503,headers:{'X-Ashare-Error-Code':code,'Retry-After':'900'}}));
   expect((await tick(f)).code).toBe(code);expect(f.request).toHaveBeenCalledTimes(1);expect(f.finish.mock.calls[0]?.[1]).toMatchObject({requests:1,stopped:false,acquisitionMs:null});
  }
 });
 it('latches refusal before reading a stalled body',async()=>{
  const f=fixture();f.request.mockResolvedValue(new Response(new ReadableStream({start(){}}),{status:503,headers:{'X-Ashare-Error-Code':'source_access_denied','X-Ashare-Recovery':'stopped'}}));
  expect((await tick(f)).code).toBe('source_access_denied');expect(f.request).toHaveBeenCalledTimes(1);expect(f.finish.mock.calls[0]?.[1]).toMatchObject({stopped:true,acquisitionMs:null});
 });
 it('strictly follows bounded continuation without reducing Retry-After',async()=>{
  vi.useFakeTimers();const f=fixture(),starts:number[]=[];
  f.request.mockImplementation(async()=>{starts.push(Date.now());return new Response(JSON.stringify({error_code:'collection_in_progress'}),{status:503,headers:{'X-Ashare-Error-Code':'collection_in_progress','X-Ashare-Recovery':'retry','Retry-After':'3'}});});
  const result=tick(f);await vi.runAllTimersAsync();expect((await result).code).toBe('collection_limit');expect(starts).toHaveLength(20);
  for(let i=1;i<starts.length;i++)expect(starts[i]-starts[i-1]).toBeGreaterThanOrEqual(3100);
 });
 it('retains ownership on a timeout, transport throw or malformed body',async()=>{
  for(const mode of ['stall','throw','invalid']){
   vi.useFakeTimers();const f=fixture();f.request.mockImplementation(async()=>{if(mode==='stall')return await new Promise<Response>(()=>{});if(mode==='throw')throw new Error('private exception');return new Response('invalid');});
   const result=tick(f);await vi.runAllTimersAsync();expect((await result).code).toBe('scheduler_outcome_unconfirmed');expect(f.finish).not.toHaveBeenCalled();expect(f.request).toHaveBeenCalledTimes(1);vi.useRealTimers();
  }
 });
 it('does not release an uncertain durable completion twice',async()=>{
  const f=fixture();f.finish.mockRejectedValue(new Error('uncertain'));expect((await tick(f)).code).toBe('scheduler_store_unconfirmed');expect(f.finish).toHaveBeenCalledTimes(1);
 });
 it('ships with no active trigger, route or public workers.dev endpoint',()=>{
  const config=JSON.parse(readFileSync(new URL('../scheduler/wrangler.example.jsonc',import.meta.url),'utf8'));
  expect(config.vars.ASHARE_SCHEDULER_ENABLED).toBe('false');expect(config.triggers.crons).toEqual([]);expect(config.workers_dev).toBe(false);expect(config.preview_urls).toBe(false);expect(config.routes).toBeUndefined();
 });
});
