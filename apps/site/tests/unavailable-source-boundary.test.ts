import {describe,expect,it} from 'vitest';
import {GET} from '../app/api/v1/status/route';
describe('unavailable statistical layer boundary',()=>{
 it('never recommends US TIC as a replacement for an unavailable global source',async()=>{
  const response=await GET(),body=await response.json() as {state:string;snapshot_version:string|null;error:string};
  expect(body.state).toBe('empty');expect(body.snapshot_version).toBeNull();
  expect(body.error).toContain('不以美国 TIC 替代');expect(body.error).not.toContain('请使用 TIC');
  expect(response.headers.get('cache-control')).toBe('no-store');
 });
});
