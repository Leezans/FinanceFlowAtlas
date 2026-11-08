// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import Page from '@/app/crypto/exchange-balances/page';
afterEach(()=>{cleanup();vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('keeps production disabled even when the personal flag is set',()=>{vi.stubEnv('NODE_ENV','production');vi.stubEnv('FFA_PERSONAL_EXCHANGE_BALANCES','1');const f=vi.fn();vi.stubGlobal('fetch',f);render(<Page/>);expect(screen.getByRole('heading').textContent).toContain('未启用');expect(f).not.toHaveBeenCalled();});
it('requires explicit local development opt-in',()=>{vi.stubEnv('NODE_ENV','development');vi.stubEnv('FFA_PERSONAL_EXCHANGE_BALANCES','');render(<Page/>);expect(screen.getByRole('heading').textContent).toContain('未启用');});
it('renders the personal acknowledgement locally without fetching',()=>{vi.stubEnv('NODE_ENV','development');vi.stubEnv('FFA_PERSONAL_EXCHANGE_BALANCES','1');const f=vi.fn();vi.stubGlobal('fetch',f);render(<Page/>);expect(screen.getByRole('checkbox')).toBeTruthy();expect(f).not.toHaveBeenCalled();});
