// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {annualCountrySources,sourceForLocation} from '../lib/catalog/sources';
import {HOSTS} from '../lib/asean/dimensions';
import {fdiSelection} from '../lib/asean/selection';
import {CountryEvidence} from '../components/navigation/EvidenceContext';
import AseanFdi from '../components/asean/AseanFdi';
import {reply,NOW} from './asean-fixture';
vi.mock('next/navigation',()=>({usePathname:()=>'/asean'}));
beforeEach(()=>{window.history.replaceState({},'','/asean');vi.useFakeTimers();vi.setSystemTime(NOW)});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();window.history.replaceState({},'','/')});
describe('annual source country relationships',()=>{
 it('maps only explicit ASEAN host dimensions and preserves world-bank candidate semantics',()=>{
  expect(new Set(HOSTS.map(host=>host.iso3)).size).toBe(11);
  for(const host of HOSTS){
   const sources=annualCountrySources(host.iso3);
   expect(sources.map(source=>source.id)).toEqual(['worldbank','asean']);
   const url=new URL(sources[1].href,'https://example.invalid');
   expect(fdiSelection(url.search)).toMatchObject({host:host.code,year:2025,invalidCountry:false,invalidYear:false});
   expect(sources[1].geographyRole).toBe('投资目的地');expect(sources[1].period).toContain('待目标矩阵核验');
  }
  expect(annualCountrySources('FRA').map(source=>source.id)).toEqual(['worldbank']);
  expect(annualCountrySources('INVALID')).toEqual([]);
  expect(sourceForLocation('/equities','?country=FRA')?.country).toBe('FRA');
  expect(sourceForLocation('/asean','?country=PHL&year=2024')?.period).toContain('2024');
  expect(sourceForLocation('/asean','?country=USA&year=2099')?.country).toBe('');
 });
 it('offers useful country deep links without acquiring reports or asserting availability',()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<CountryEvidence country="PHL"/>);
  expect(screen.getByRole('link',{name:/核验该国年度股市指标/}).getAttribute('href')).toBe('/equities?country=PHL#country-equity');
  expect(screen.getByRole('link',{name:/东盟 FDI 行业/}).getAttribute('href')).toBe('/asean?country=PHL&year=2025');
  expect(screen.getByText(/不保证该国已有观测或当前在线/)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('deep-links a country/year into its actual heatmap and restores history without extra fetches',async()=>{
  window.history.replaceState({},'','/asean?country=PHL&year=2024');
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);
  render(<AseanFdi/>);await act(()=>vi.advanceTimersByTimeAsync(1));
  expect(screen.getByRole('combobox',{name:'接收国'})).toHaveProperty('value','PH');
  expect(screen.getByRole('combobox',{name:'观察年份'})).toHaveProperty('value','2024');
  expect(document.querySelector('[data-layout=treemap]')).toBeTruthy();
  expect(screen.getByRole('link',{name:'返回菲律宾国家证据 →'}).getAttribute('href')).toBe('/markets?country=PHL');
  fireEvent.change(screen.getByRole('combobox',{name:'接收国'}),{target:{value:'SG'}});
  expect(window.location.search).toBe('?country=SGP&year=2024');
  fireEvent.change(screen.getByRole('combobox',{name:'观察年份'}),{target:{value:'2025'}});
  expect(window.location.search).toBe('?country=SGP&year=2025');
  act(()=>{window.history.replaceState({},'','/asean?country=PHL&year=2024');window.dispatchEvent(new PopStateEvent('popstate'))});
  expect(screen.getByRole('combobox',{name:'接收国'})).toHaveProperty('value','PH');
  expect(screen.getByRole('combobox',{name:'观察年份'})).toHaveProperty('value','2024');
  fireEvent.change(screen.getByRole('combobox',{name:'接收国'}),{target:{value:''}});
  expect(window.location.search).toBe('?year=2024');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('rejects unsupported selections visibly and preserves no-data rather than fabricating annual values',async()=>{
  window.history.replaceState({},'','/asean?country=USA&year=2099');
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({snapshot:null,status:{...reply().status,state:'unavailable'}},{status:503})));
  render(<AseanFdi/>);await act(()=>vi.advanceTimersByTimeAsync(1));
  expect(screen.getByText(/国家参数不在已核验的 11 个接收国代码内/)).toBeTruthy();
  expect(screen.getByRole('combobox',{name:'观察年份'})).toHaveProperty('value','2025');
  expect(screen.queryByRole('table')).toBeNull();expect(screen.getByText('行业矩阵已保留，等待可验证的官方数据')).toBeTruthy();
 });
});
