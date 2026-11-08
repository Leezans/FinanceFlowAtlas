// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidenceSources,relatedSources,sourceForLocation,sourcesForCountry,sourcesForPath} from '../lib/catalog/sources';
import EvidenceContext,{CountryEvidence} from '../components/navigation/EvidenceContext';
import MarketNavigation from '../components/navigation/MarketNavigation';
let pathname='/taiwan';
vi.mock('next/navigation',()=>({usePathname:()=>pathname}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();pathname='/taiwan';window.history.replaceState({},'','/')});
describe('evidence relationship contract',()=>{
 it('uses unique stable identities and existing routes without creating observations',()=>{
  expect(new Set(evidenceSources.map(s=>s.id)).size).toBe(evidenceSources.length);
  for(const source of evidenceSources){
   expect(existsSync(resolve(process.cwd(),`app${source.href.split(/[?#]/)[0]}/page.tsx`))).toBe(true);
   expect(source.metric && source.unit && source.frequency && source.geographyRole && source.boundary).toBeTruthy();
   expect(source).not.toHaveProperty('value');expect(source).not.toHaveProperty('available');expect(source).not.toHaveProperty('asOf');
  }
 });
 it('links Taiwan across asset classes without treating shares, notional and premium as money children',()=>{
  const sources=sourcesForCountry('TWN');
  expect(sources.map(s=>s.id)).toEqual(['tpex-shares','taifex-futures','taifex-options','tpex-money','worldbank']);
  expect(new Set(sources.map(s=>s.metric)).size).toBe(5);
  expect(sources.find(s=>s.id==='tpex-shares')?.unit).toBe('股');
  expect(sources.find(s=>s.id==='taifex-futures')?.boundary).toContain('不与期权权利金合计');
 });
 it('does not map US counterparties, currencies or global venues to a local equity market',()=>{
  expect(sourcesForCountry('JPN').map(s=>s.id)).toEqual(['mof','worldbank']);
  expect(sourcesForCountry('DEU').map(s=>s.id)).toEqual(['worldbank']);
  expect(sourcesForCountry('USA').map(s=>s.geographyRole)).toEqual(['监管报告市场','发行人市场','国家统计']);
  expect(evidenceSources.find(s=>s.id==='kraken')?.country).toBe('');
 });
 it('keeps exact routes and links only related assets or explicit country identities',()=>{
  expect(sourcesForPath('/options/taiwan')[0].id).toBe('taifex-options');
  expect(sourcesForPath('/')[0].id).toBe('ashare');
  expect(sourcesForPath('/unknown')).toEqual([]);
  const kraken=evidenceSources.find(s=>s.id==='kraken')!;
  expect(relatedSources(kraken).map(s=>s.id)).toEqual(['deribit']); // Explicit shared crypto underlyings, not an invented country.
 });
});
describe('contextual navigation',()=>{
 it('keeps the current hierarchy visible and discloses related sources without fetching them',()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<EvidenceContext/>);
  expect(screen.getByRole('navigation',{name:'证据层级'}).textContent).toContain('TPEx 公司行业 → 个股');
  expect(screen.getByRole('link',{name:'TWN · 本地市场'}).getAttribute('href')).toBe('/markets?country=TWN');
  fireEvent.click(screen.getByText('关联矩阵与口径边界'));
  expect(screen.getByText(/股数不能与 TWD 金额相加/)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('changes same-country links when the selected country changes',()=>{
  const view=render(<CountryEvidence country="TWN"/>);
  expect(screen.getAllByRole('link')).toHaveLength(5);
  view.rerender(<CountryEvidence country="JPN"/>);
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(screen.queryByText('台湾期权日报')).toBeNull();
  view.rerender(<CountryEvidence country="INVALID"/>);expect(view.container.textContent).toBe('');
 });
 it('tracks query-backed sources through country selection, Back/Forward and TIC hash changes',()=>{
  pathname='/markets';window.history.replaceState({},'', '/markets?country=TWN');
  const view=render(<MarketNavigation/>);
  const active=()=>view.container.querySelector('[aria-current=page]')?.getAttribute('href');
  expect(active()).toBe('/markets?country=TWN');
  expect(screen.getByRole('navigation',{name:'证据层级'}).textContent).toContain('三类法人；无行业金额');
  act(()=>{window.history.pushState({},'', '/markets?country=JPN');window.dispatchEvent(new Event('atlas-country-change'))});
  expect(active()).toBe('/markets?country=JPN');expect(screen.getByText('跨境证券 · 当前')).toBeTruthy();
  act(()=>{window.history.replaceState({},'', '/markets?country=TWN');window.dispatchEvent(new PopStateEvent('popstate'))});
  expect(active()).toBe('/markets?country=TWN');
  act(()=>{window.history.replaceState({},'', '/markets?country=USA');window.dispatchEvent(new PopStateEvent('popstate'))});
  expect(active()).toBe('/markets');expect(screen.queryByRole('navigation',{name:'证据层级'})).toBeNull();
  act(()=>{window.history.replaceState({},'', '/markets?country=USA#us-tic-supplement');window.dispatchEvent(new HashChangeEvent('hashchange'))});
  expect(active()).toBe('/markets?country=USA#us-tic-supplement');
  expect(view.container.querySelectorAll('[aria-current=page]')).toHaveLength(1);
  act(()=>{window.history.replaceState({},'', '/markets?country=USA');window.dispatchEvent(new HashChangeEvent('hashchange'))});
  expect(active()).toBe('/markets');
  expect(sourceForLocation('/markets','?country=JPN&extra=1')?.id).toBe('mof');
  expect(sourceForLocation('/markets','?country=DEU','#us-tic-supplement')).toBeUndefined();
 });
 it('groups implemented asset entries and keeps precise nested-route selection',()=>{
  pathname='/options/taiwan';const view=render(<MarketNavigation/>);
  expect(screen.getByText('期权 · 当前')).toBeTruthy();
  expect(view.container.querySelectorAll('[aria-current=page]')).toHaveLength(1);
  expect(view.container.querySelector('[aria-current=page]')?.getAttribute('href')).toBe('/options/taiwan');
  pathname='/futures';view.rerender(<MarketNavigation/>);
  expect(screen.getByText('期货 · 当前')).toBeTruthy();
  expect(view.container.querySelector('[aria-current=page]')?.getAttribute('href')).toBe('/futures');
 });
});
