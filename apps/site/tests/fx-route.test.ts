import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fxPayload} from './fx-fixture';
const mocked=vi.hoisted(()=>({read:vi.fn()}));
import {serveFx} from '../lib/fx/route';
beforeEach(()=>mocked.read.mockReset());
describe('FX reference API',()=>{
 it('returns explicitly non-flow, non-public-cacheable reference data',async()=>{
  mocked.read.mockResolvedValue(fxPayload());const response=await serveFx(mocked);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('x-data-concept')).toBe('exchange-rate-reference');
 });
 it('retains stale status and emits 503 when no validated reference exists',async()=>{
  mocked.read.mockResolvedValue({...fxPayload(),source_state:'stale',error_code:'network_error'});const stale=await serveFx(mocked);expect(stale.status).toBe(200);expect(stale.headers.get('warning')).toContain('Last validated');
  mocked.read.mockResolvedValue({...fxPayload(),snapshot:null,source_state:'unavailable',error_code:'network_error'});expect((await serveFx(mocked)).status).toBe(503);
 });
});
