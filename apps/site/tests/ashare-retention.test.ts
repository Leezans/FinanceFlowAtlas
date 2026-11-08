import {describe,expect,it,vi} from 'vitest';
import {consumeReply,emptyState,createEvidenceClient,type WireReply} from '../components/ashare/client';
import {ashareSnapshotExpiresAt} from '../lib/ashare/retention';
import {ashareReportFixture,ASHARE_REPORT_NOW as now,ASHARE_REPORT_ROOT as scope} from './organized-ashare-fixture';

describe('browser evidence retention',()=>{
 it('clears snapshot and ETag after the oldest acquisition reaches 24h on a temporary error',()=>{
  const ready=consumeReply(emptyState(),{status:200,payload:ashareReportFixture(),etag:'synthetic'},scope,now);
  const failed=consumeReply(ready,{status:503,errorCode:'snapshot_store_unavailable',retryAfter:'60'},scope,now+2*86400000);
  expect(failed.snapshot).toBeNull();expect(failed.etag).toBeNull();
 });
});

const snapshot=ashareReportFixture(),expiry=ashareSnapshotExpiresAt(snapshot);
const ready=()=>consumeReply(emptyState(),{status:200,payload:snapshot,etag:'old'},scope,now);
describe('precise retention across response and request lifetimes',()=>{
 it.each([200,304,503])('expires HTTP %i exactly at earliest acquisition +24h',status=>{
  const reply={status,payload:snapshot,etag:'old',errorCode:status===503?'upstream_http':undefined,retryAfter:'900'};
  expect(consumeReply(ready(),reply,scope,expiry-1).snapshot).not.toBeNull();
  const expired=consumeReply(ready(),reply,scope,expiry);
  expect(expired.snapshot).toBeNull();expect(expired.etag).toBeNull();
  if(status===503)expect(expired.recovery?.retryAt).toBe(expiry+900000);
 });
 it('uses fetched_at for older snapshots without collection_started_at',()=>{
  const old=ashareReportFixture({collection:false});expect(ashareSnapshotExpiresAt(old)).toBe(now+86400000);
 });
 it('evicts during cooldown without permitting a request or shortening recovery',async()=>{
  let clock=now;
  const transport=vi.fn().mockResolvedValueOnce({status:200,payload:snapshot,etag:'old'}).mockResolvedValue({status:503,errorCode:'upstream_http',retryAfter:'172800'});
  const client=createEvidenceClient(transport,()=>clock);await client.load(scope);await client.load(scope);
  const recovery=client.getState().recovery;clock=expiry;
  expect(client.getState()).toMatchObject({snapshot:null,etag:null,recovery});expect(client.canLoad(scope)).toBe(false);
  await client.load(scope);expect(transport).toHaveBeenCalledTimes(2);
 });
 it.each(['network','304','expired200','fresh200'] as const)('does not resurrect expired prior bytes or discard a fresh late %s',async outcome=>{
  let clock=now,resolve!:(reply:WireReply)=>void,reject!:(error:Error)=>void;
  const transport=vi.fn().mockResolvedValueOnce({status:200,payload:snapshot,etag:'old'}).mockImplementationOnce(()=>new Promise<WireReply>((yes,no)=>{resolve=yes;reject=no;})).mockResolvedValue({status:503});
  const client=createEvidenceClient(transport,()=>clock);await client.load(scope);const pending=client.load(scope);
  clock=expiry;expect(client.getState().snapshot).toBeNull();
  if(outcome==='network')reject(new Error('offline'));
  else resolve(outcome==='304'?{status:304}:{status:200,payload:outcome==='fresh200'?ashareReportFixture({now:clock}):snapshot,etag:'new'});
  const result=await pending;
  expect(result.snapshot!==null).toBe(outcome==='fresh200');expect(result.etag).toBe(outcome==='fresh200'?'new':null);
  if(outcome==='network'){expect(result.recovery?.retryAt).toBe(clock+60000);clock+=60000;}
  await client.load(scope);expect(transport.mock.calls[2][0].ifNoneMatch).toBe(outcome==='fresh200'?'new':undefined);
 });
 it('cannot reopen an explicit stop after retention',async()=>{
  let clock=now;const transport=vi.fn().mockResolvedValueOnce({status:200,payload:snapshot}).mockResolvedValue({status:503,errorCode:'source_outcome_unconfirmed'});
  const client=createEvidenceClient(transport,()=>clock);await client.load(scope);await client.load(scope);clock=expiry+1;await client.load(scope);
  expect(client.getState().recovery?.mode).toBe('stopped');expect(transport).toHaveBeenCalledTimes(2);
 });
});

it('keeps a late 304 cooldown after local expiry removed its cached bytes',async()=>{
 let clock=now,resolve!:(reply:WireReply)=>void;
 const transport=vi.fn().mockResolvedValueOnce({status:200,payload:snapshot,etag:'old'}).mockImplementationOnce(()=>new Promise<WireReply>(yes=>{resolve=yes;}));
 const client=createEvidenceClient(transport,()=>clock);await client.load(scope);const pending=client.load(scope);
 clock=expiry;expect(client.getState().snapshot).toBeNull();resolve({status:304,errorCode:'source_cooldown',retryAfter:'900'});await pending;
 expect(client.getState()).toMatchObject({snapshot:null,etag:null,recovery:{mode:'retry',retryAt:expiry+900000}});
 expect(client.canLoad(scope)).toBe(false);await client.load(scope);expect(transport).toHaveBeenCalledTimes(2);
});
