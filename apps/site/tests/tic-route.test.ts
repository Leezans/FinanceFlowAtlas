import {beforeEach,describe,it,expect,vi} from 'vitest';
import {normalize} from '../lib/tic/adapter';
import {valid} from './tic-fixture';
const fake=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../lib/tic/cache',()=>({getTic:fake.read}));
vi.mock('../lib/tic/d1',()=>({repository:()=>({})}));
import {serveTic} from '../lib/tic/route';
beforeEach(()=>{fake.read.mockReset()});
describe('hosted read-only TIC routes',()=>{
 it('returns unavailable status and 503 snapshot without substitutes',async()=>{fake.read.mockResolvedValue({snapshot:null,status:{state:'unavailable',last_checked_at:null,error:'Source unavailable'}});const status=await serveTic(new Request('https://example.test/status'),'status');expect(((await status.json()) as {state:string}).state).toBe('unavailable');const snapshot=await serveTic(new Request('https://example.test/tic'),'snapshot');expect(snapshot.status).toBe(503)});
 it('returns validated snapshot with state-aware ETags and stale warning',async()=>{const snapshot=await normalize(valid());fake.read.mockResolvedValue({snapshot,status:{state:'available',last_checked_at:snapshot.retrieved_at,error:null}});const first=await serveTic(new Request('https://example.test/tic'),'snapshot');expect(first.status).toBe(200);const etag=first.headers.get('ETag')!;const cached=await serveTic(new Request('https://example.test/tic',{headers:{'If-None-Match':etag}}),'snapshot');expect(cached.status).toBe(304);fake.read.mockResolvedValue({snapshot,status:{state:'stale',last_checked_at:snapshot.retrieved_at,error:'Refresh failed'}});const stale=await serveTic(new Request('https://example.test/tic',{headers:{'If-None-Match':etag}}),'snapshot');expect(stale.status).toBe(200);expect(stale.headers.get('X-Data-Status')).toBe('stale');expect(stale.headers.get('Warning')).toContain('Last validated');expect(((await stale.json()) as {version:string}).version).toBe(snapshot.version)});
});

describe('TIC source coordination response metadata',()=>{
 it('exposes a full cooldown in both status JSON and absent-snapshot 503 headers',async()=>{
  const deadline=new Date(Date.now()+3600_000).toISOString();
  fake.read.mockResolvedValue({snapshot:null,status:{state:'unavailable',last_checked_at:null,error:'temporary',source_status:'cooldown',next_retry_at:deadline}});
  for(const mode of ['status','snapshot'] as const){const response=await serveTic(new Request('https://example.test/tic'),mode);expect(response.headers.get('X-Source-Status')).toBe('cooldown');expect(response.headers.get('X-Next-Retry-At')).toBe(deadline);expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(3599);expect(((await response.json()) as {next_retry_at:string}).next_retry_at).toBe(deadline)}
 });
 it('sends denial metadata with both a retained 200 and its 304',async()=>{
  const snapshot=await normalize(valid());fake.read.mockResolvedValue({snapshot,status:{state:'stale',last_checked_at:null,error:'denied',source_status:'denied',next_retry_at:null}});
  const first=await serveTic(new Request('https://example.test/tic'),'snapshot');expect(first.headers.get('X-Source-Status')).toBe('denied');
  const second=await serveTic(new Request('https://example.test/tic',{headers:{'If-None-Match':first.headers.get('ETag')!}}),'snapshot');expect(second.status).toBe(304);expect(second.headers.get('X-Source-Status')).toBe('denied');
 });
 it('marks cache coordination failure as stopped without exposing error details',async()=>{
  fake.read.mockRejectedValue(new Error('synthetic private details'));const response=await serveTic(new Request('https://example.test/tic'),'snapshot');expect(response.headers.get('X-Source-Status')).toBe('coordination_unavailable');expect(await response.text()).not.toContain('synthetic private');
 });
});
