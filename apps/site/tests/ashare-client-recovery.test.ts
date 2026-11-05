import {describe,expect,it,vi} from 'vitest';
import {consumeReply,createEvidenceClient,emptyState,retryAt} from '../components/ashare/client';
import {validateEvidence,type Scope} from '../components/ashare/model';
import {safeSourceCode} from '../lib/ashare/recovery';
const scope:Scope={kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'};
const stocks:Scope={kind:'industry_stocks',fs:'b:BK0001',classification_level:'unknown_may_mix_levels'};
const row={f12:'BK0001',f14:'合成行业',f2:1,f3:1,f62:-10,f184:1,f66:1,f69:1,f72:1,f75:1,f78:1,f81:1,f84:1,f87:1};
const snapshot=validateEvidence({schema:'ashare-provider-evidence/1',rows:[row],source_total:1,fetched_at:'2026-01-02T08:00:00Z',scope,page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:'index_points'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'合成测试',stale:false,has_error:false});
const ready=()=>consumeReply(emptyState(),{status:200,etag:'"good"',payload:snapshot},scope,0);
describe('same-scope validated browser recovery',()=>{
 it.each([500,502,503,504])('retains exact same-scope bytes and ETag on HTTP %i',status=>{
  const previous=ready(),result=consumeReply(previous,{status,retryAfter:'120',errorCode:'upstream_http'},scope,1000);
  expect(result).toMatchObject({status:'stale',retainedAfterFailure:true,etag:'"good"',recovery:{code:'upstream_http',mode:'retry',retryAt:121000}});
  expect(result.snapshot).toBe(previous.snapshot);expect(result.snapshot?.fetched_at).toBe(snapshot.fetched_at);expect(result.snapshot?.stale).toBe(false);
 });
 it('retains on rejected transport, respects cooldown, and recovers via 304 without rewriting observations',async()=>{
  let now=0;const transport=vi.fn().mockResolvedValueOnce({status:200,payload:snapshot,etag:'"good"'}).mockRejectedValueOnce(new Error('private transport detail')).mockResolvedValue({status:304,etag:'"good"'});
  const client=createEvidenceClient(transport,()=>now);await client.load(scope);const initial=client.getState().snapshot;await client.load(scope);
  expect(client.getState()).toMatchObject({status:'stale',retainedAfterFailure:true,recovery:{code:'browser_network'}});
  expect(JSON.stringify(client.getState())).not.toContain('private transport detail');await client.load(scope);expect(transport).toHaveBeenCalledTimes(2);
  now=60000;await client.load(scope);expect(transport).toHaveBeenCalledTimes(3);expect(transport.mock.calls[2][0].ifNoneMatch).toBe('"good"');
  expect(client.getState()).toMatchObject({status:'ready',snapshot:initial});expect(client.getState().recovery).toBeUndefined();expect(client.getState().retainedAfterFailure).toBeUndefined();
 });
 it('never retains another scope and never sends its ETag',async()=>{
  const transport=vi.fn().mockResolvedValueOnce({status:200,payload:snapshot,etag:'"good"'}).mockResolvedValue({status:503});
  const client=createEvidenceClient(transport);await client.load(scope);await client.load(stocks);
  expect(transport.mock.calls[1][0].ifNoneMatch).toBeUndefined();expect(client.getState().snapshot).toBeNull();
  expect(consumeReply(ready(),{status:503},stocks).snapshot).toBeNull();
 });
 it.each([401,403,400,404,429])('clears evidence for non-temporary HTTP %i',status=>{
  const result=consumeReply(ready(),{status},scope);expect(result.snapshot).toBeNull();expect(result.etag).toBeNull();
 });
 it.each(['source_access_denied','persistent_source_denial','source_denial_latched','source_gate_release_unconfirmed','invalid_source_lease','html_challenge','non_json_challenge','redirect_denied','automatic_redirect_denied','provider_error_or_challenge'])('clears and stops for %s, including stale 200/304',errorCode=>{
  for(const status of [200,304,503]){
   const result=consumeReply(ready(),{status,payload:{...snapshot,stale:true,has_error:true},errorCode},scope);
   expect(result).toMatchObject({snapshot:null,etag:null,status:'blocked',recovery:{mode:'stopped',retryAt:null}});
  }
 });
 it('treats an unknown stopped code as stopped without exposing it',()=>{
  const result=consumeReply(ready(),{status:200,payload:snapshot,errorCode:'private-server-detail',recoveryMode:'stopped'},scope);
  expect(result).toMatchObject({snapshot:null,status:'blocked',recovery:{mode:'stopped',code:'collection_failed'}});expect(JSON.stringify(result)).not.toContain('private-server-detail');
 });
 it('never retries a known stop on repeated calls',async()=>{
  const transport=vi.fn(async()=>({status:503,errorCode:'html_challenge'}));const client=createEvidenceClient(transport,()=>99999999);
  await client.load(scope);await client.load(scope);expect(client.canLoad(scope)).toBe(false);expect(transport).toHaveBeenCalledTimes(1);
 });
 it('clears malformed, partial, or wrong-scope successful bodies',()=>{
  for(const payload of [{...snapshot,source_total:2},{...snapshot,scope:stocks},{...snapshot,field_units:{f2:'CNY'}},'<html>private</html>'])expect(consumeReply(ready(),{status:200,payload},scope).snapshot).toBeNull();
  expect(consumeReply(ready(),{status:200,payload:{...snapshot,has_error:true,stale:false}},scope).snapshot).toBeNull();
 });
 it('keeps server-origin stale distinct and updates 304 diagnostics',()=>{
  const old=consumeReply(ready(),{status:200,payload:{...snapshot,stale:true,has_error:true},errorCode:'upstream_http',retryAfter:'120'},scope,0);
  const next=consumeReply(old,{status:304,errorCode:'upstream_http',retryAfter:'90'},scope,30000);
  expect(next).toMatchObject({status:'stale',recovery:{retryAt:120000}});expect(next.retainedAfterFailure).toBeUndefined();expect(next.snapshot).toBe(old.snapshot);
 });
 it('retains error recovery for a headerless stale 304 from an older server',()=>{
  const old=consumeReply(ready(),{status:200,payload:{...snapshot,stale:true,has_error:true}},scope,0);
  const next=consumeReply(old,{status:304},scope,60000);
  expect(next).toMatchObject({status:'stale',recovery:{code:'collection_failed',retryAt:120000}});
 });
 it('rejects a 304 without matching verified bytes',()=>{
  expect(consumeReply(emptyState(),{status:304},scope).status).toBe('error');expect(consumeReply(ready(),{status:304},stocks).snapshot).toBeNull();
 });
 it('ignores old scope completions and clears without local persistence',async()=>{
  let finish!:(value:{status:number;payload:unknown})=>void;
  const transport=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({status:503});
  const client=createEvidenceClient(transport);const old=client.load(scope);await client.load(stocks);finish({status:200,payload:snapshot});await old;
  expect(client.getState().snapshot).toBeNull();client.clear();expect(client.getState()).toEqual(emptyState());
 });
 it('never renders arbitrary server messages or codes',()=>{
  const result=consumeReply(ready(),{status:503,payload:{error_code:'<script>secret</script>',message:'private source text'},errorCode:'secret URL'},scope,0);
  expect(result.recovery?.code).toBe('collection_failed');expect(JSON.stringify(result)).not.toMatch(/secret|private source text/);expect(safeSourceCode('__proto__')).toBeNull();
 });
});
describe('retry timing',()=>{
 const now=Date.parse('2026-11-05T00:00:00Z');
 it('honors numeric and date headers without shortening longer waits',()=>{
  expect(retryAt('900',now)).toBe(now+900000);expect(retryAt('Thu, 05 Nov 2026 00:02:00 GMT',now)).toBe(now+120000);expect(retryAt('0',now)).toBe(now+1000);
 });
 it.each([undefined,'nonsense','Infinity','99999999999999999999999999'])('uses safe default for %s',value=>expect(retryAt(value,now)).toBe(now+60000));
});
