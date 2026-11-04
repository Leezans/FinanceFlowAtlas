import {beforeEach,describe,it,expect,vi} from 'vitest';
import {normalize} from '../lib/tic/adapter';
import {valid} from './tic-fixture';
const fake=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../lib/tic/cache',()=>({getTic:fake.read}));
vi.mock('../lib/tic/d1',()=>({repository:()=>({})}));
import {serveTic} from '../lib/tic/route';
beforeEach(()=>fake.read.mockReset());
describe('hosted read-only TIC routes',()=>{
 it('returns unavailable status and 503 snapshot without substitutes',async()=>{fake.read.mockResolvedValue({snapshot:null,status:{state:'unavailable',last_checked_at:null,error:'Source unavailable'}});const status=await serveTic(new Request('https://example.test/status'),'status');expect(((await status.json()) as {state:string}).state).toBe('unavailable');const snapshot=await serveTic(new Request('https://example.test/tic'),'snapshot');expect(snapshot.status).toBe(503)});
 it('returns validated snapshot with state-aware ETags and stale warning',async()=>{const snapshot=await normalize(valid());fake.read.mockResolvedValue({snapshot,status:{state:'available',last_checked_at:snapshot.retrieved_at,error:null}});const first=await serveTic(new Request('https://example.test/tic'),'snapshot');expect(first.status).toBe(200);const etag=first.headers.get('ETag')!;const cached=await serveTic(new Request('https://example.test/tic',{headers:{'If-None-Match':etag}}),'snapshot');expect(cached.status).toBe(304);fake.read.mockResolvedValue({snapshot,status:{state:'stale',last_checked_at:snapshot.retrieved_at,error:'Refresh failed'}});const stale=await serveTic(new Request('https://example.test/tic',{headers:{'If-None-Match':etag}}),'snapshot');expect(stale.status).toBe(200);expect(stale.headers.get('X-Data-Status')).toBe('stale');expect(stale.headers.get('Warning')).toContain('Last validated');expect(((await stale.json()) as {version:string}).version).toBe(snapshot.version)});
});
