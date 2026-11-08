// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import ExchangeBalances from '@/components/crypto/ExchangeBalances';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('does not fetch on mount, requires opt-in, and never retries denied access',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:false,status:403});vi.stubGlobal('fetch',fetcher);
 render(<ExchangeBalances/>);expect(fetcher).not.toHaveBeenCalled();const button=screen.getByRole('button') as HTMLButtonElement;expect(button.disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button);fireEvent.click(button);
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('403'));
 expect(fetcher).toHaveBeenCalledTimes(1);expect(button.disabled).toBe(true);
});
it('aborts an in-flight request on unmount',()=>{const fetcher=vi.fn(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetcher);const r=render(<ExchangeBalances/>);fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button'));const signal=fetcher.mock.calls[0] as unknown as [string,{signal:AbortSignal}];r.unmount();expect(signal[1].signal.aborted).toBe(true);});
it('shows exact historical interval and native units without implying market flow',async()=>{
 const day=86400,t=Math.floor(Date.now()/1000/day)*day;
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({name:'Binance CEX',chains:['Ethereum'],tokens:[{date:t-2*day,tokens:{BTC:2}},{date:t-day,tokens:{BTC:3}}],tokensInUsd:[{date:t-day,tokens:{BTC:300}}]})});vi.stubGlobal('fetch',fetcher);
 render(<ExchangeBalances/>);fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button'));
 await waitFor(()=>expect(screen.getByRole('table')).toBeTruthy());expect(screen.getByText('BTC')).toBeTruthy();expect(screen.getByText(/隐含单价 =/)).toBeTruthy();expect(screen.getByText(/比较区间/).textContent).toContain('UTC');
});
