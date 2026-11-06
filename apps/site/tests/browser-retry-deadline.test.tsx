// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,render} from '@testing-library/react';
import {absoluteRetryDeadline} from '../lib/browser-request';
import {useReport} from '../components/markets/useReport';
import {useCboeSnapshot} from '../components/cboe/useCboeSnapshot';
import {useSnapshot} from '../components/polymarket/useSnapshot';
import {replySchema as japanSchema,REFRESH_MS as JAPAN_REFRESH} from '../lib/japan/model';
import {japanFixture,JAPAN_TEST_NOW as NOW} from './japan-mof-ui-fixture';
import {reply as cboeReply} from './cboe-fixture';
import {reply as polymarketReply} from './polymarket-fixture';
const parseJapan=(value:unknown)=>japanSchema.parse(value);
function Japan(){useReport('/api/v1/japan/mof/snapshot',parseJapan,JAPAN_REFRESH);return null;}
function Cboe(){useCboeSnapshot();return null;}
function Polymarket({view='newest'}:{view?:'newest'|'hot'}={}){useSnapshot(view);return null;}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
it.each(['2026-11-06T10:00:00+99:99','2026-11-06T10:00:00+24:00',null,undefined,'invalid'])('never turns invalid absolute deadline %s into NaN',value=>{expect(absoluteRetryDeadline(value)).toBe(0);});
it('preserves valid UTC/offset absolute deadlines without shortening them',()=>{for(const value of ['2026-11-06T10:00:00Z','2026-11-06T10:00:00+09:00','2099-12-31T23:59:59Z'])expect(absoluteRetryDeadline(value)).toBe(Date.parse(value));});
it.each([['Japan',Japan,japanFixture,60_000],['Cboe',Cboe,cboeReply,60_000],['Polymarket',Polymarket,polymarketReply,30_000]] as const)('%s retains its minimum browser pause when a validated datetime has an impossible offset',async(_name,Component,fixture,pause)=>{
 const value=fixture();value.status.next_retry_at='2026-11-06T10:00:00+99:99';const f=vi.fn(async()=>Response.json(value));vi.stubGlobal('fetch',f);render(<Component/>);
 await act(()=>vi.advanceTimersByTimeAsync(100));expect(f).toHaveBeenCalledOnce();await act(()=>vi.advanceTimersByTimeAsync(pause-101));expect(f).toHaveBeenCalledOnce();await act(()=>vi.advanceTimersByTimeAsync(1));expect(f).toHaveBeenCalledTimes(2);
});
it('uses a valid shared Polymarket deadline even if its mode deadline is invalid',async()=>{
 const value=polymarketReply();value.status.next_retry_at='2026-11-06T10:00:00+99:99';value.status.source_next_retry_at=new Date(NOW+180_000).toISOString();const f=vi.fn(async()=>Response.json(value));vi.stubGlobal('fetch',f);render(<Polymarket/>);await act(()=>vi.advanceTimersByTimeAsync(179_999));expect(f).toHaveBeenCalledOnce();await act(()=>vi.advanceTimersByTimeAsync(1));expect(f).toHaveBeenCalledTimes(2);
});

it('retains a valid Polymarket mode pause across modes when the shared datetime is invalid',async()=>{
 const value=polymarketReply();value.status.source_next_retry_at='2026-11-06T10:00:00+99:99';value.status.next_retry_at=new Date(NOW+180_000).toISOString();const f=vi.fn(async()=>Response.json(value));vi.stubGlobal('fetch',f);const view=render(<Polymarket/>);await act(()=>vi.advanceTimersByTimeAsync(100));view.rerender(<Polymarket view="hot"/>);await act(()=>vi.advanceTimersByTimeAsync(179_899));expect(f).toHaveBeenCalledOnce();await act(()=>vi.advanceTimersByTimeAsync(1));expect(f).toHaveBeenCalledTimes(2);
});
