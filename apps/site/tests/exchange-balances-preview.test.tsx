// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://preview.terminal.local/crypto/exchange-balances"}
import React from 'react';
import {expect,it,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import ExchangeBalances from '@/components/crypto/ExchangeBalances';
it('refuses a non-loopback development preview without contacting the provider',()=>{const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<ExchangeBalances/>);expect(screen.getByRole('heading').textContent).toContain('回环');expect(screen.queryByRole('checkbox')).toBeNull();expect(fetcher).not.toHaveBeenCalled();vi.unstubAllGlobals();});
