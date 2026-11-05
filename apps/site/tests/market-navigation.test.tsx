// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import MarketNavigation,{marketLinks} from '../components/navigation/MarketNavigation';
import MarketLanding from '../components/home/MarketLanding';

let pathname:string|null='/';
vi.mock('next/navigation',()=>({usePathname:()=>pathname}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();pathname='/'});

describe('market navigation',()=>{
 it('links only implemented pages including the separate daily FX reference',()=>{
  render(<MarketNavigation/>);
  const nav=screen.getByRole('navigation',{name:'市场导航'});
  expect(within(nav).getAllByRole('link').map(a=>a.getAttribute('href'))).toEqual(['/ashare','/taiwan','/brazil','/markets','/asean','/crypto','/futures','/forex','/']);
  expect(within(nav).getByRole('link',{name:'外汇参考'}).getAttribute('href')).toBe('/forex');
  expect(within(nav).queryByText('即将接入')).toBeNull();
  for(const link of marketLinks)expect(existsSync(resolve(process.cwd(),`app${link.href==='/'?'':link.href}/page.tsx`))).toBe(true);
 });
 it.each(['/ashare','/taiwan','/brazil','/markets','/asean','/crypto','/futures','/forex','/'])('marks the exact current page %s',route=>{
  pathname=route;const {container}=render(<MarketNavigation/>);
  expect(container.querySelectorAll('[aria-current=page]')).toHaveLength(1);
  expect(container.querySelector('[aria-current=page]')?.getAttribute('href')).toBe(route);
 });
 it('updates active state on navigation and has no incorrect default on unknown paths',()=>{
  const view=render(<MarketNavigation/>);pathname='/ashare';view.rerender(<MarketNavigation/>);
  expect(view.container.querySelector('[aria-current=page]')?.getAttribute('href')).toBe('/ashare');
  pathname='/missing';view.rerender(<MarketNavigation/>);expect(view.container.querySelector('[aria-current]')).toBeNull();
  pathname=null;view.rerender(<MarketNavigation/>);expect(view.container.querySelector('[aria-current]')).toBeNull();
 });
 it('is installed by the shared layout rather than only on the homepage',()=>{
  const layout=readFileSync(resolve(process.cwd(),'app/layout.tsx'),'utf8');
  expect(layout).toContain('<MarketNavigation/>');
 });
});

describe('visual market entry',()=>{
 it('makes A-share prominent while preserving global, crypto and TIC access',()=>{
  render(<MarketLanding/>);
  const section=screen.getByRole('region',{name:'选择市场视图'});
  expect(within(section).getByRole('link',{name:'打开 A 股热力图：行业到个股'}).getAttribute('href')).toBe('/ashare');
  expect(within(section).getByRole('link',{name:'打开全球市场地图'}).getAttribute('href')).toBe('/markets');
  expect(within(section).getByRole('link',{name:'打开加密现货：Kraken BTC 和 ETH'}).getAttribute('href')).toBe('/crypto');
  expect(within(section).getByRole('link',{name:'继续看美国 TIC'}).getAttribute('href')).toBe('#tic-view');
  expect(within(section).queryByRole('table')).toBeNull();
  expect(within(section).getByRole('link',{name:'打开外汇参考：ECB 每日汇率'}).getAttribute('href')).toBe('/forex');
  expect(within(section).getByRole('navigation',{name:'选择矩阵市场'})).toBeTruthy();
 });
 it('does not fetch other sources or invent observations to decorate the landing',()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const {container}=render(<MarketLanding/>);
  expect(fetcher).not.toHaveBeenCalled();
  expect(container.querySelectorAll('svg:not([aria-hidden=true])')).toHaveLength(0);
  expect(screen.getByText(/主力净额是订单分类估算，非市场真实新增资金/)).toBeTruthy();
  expect(screen.getByText(/不混合单位、时点或口径/)).toBeTruthy();
 });
 it('preserves the homepage TIC component and its direct anchor',()=>{
  const app=readFileSync(resolve(process.cwd(),'components/atlas/App.tsx'),'utf8');
  expect(app).toContain('<MarketLanding onOpenTic=');expect(app).toContain('<AshareWorkspace embedded/>');expect(app).toContain('id="tic-view"');expect(app).toContain('{ticOpen&&<TicLayer/>}');
 });
});
