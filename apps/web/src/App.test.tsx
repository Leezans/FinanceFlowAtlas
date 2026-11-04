// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,waitFor,fireEvent,cleanup} from '@testing-library/react';
import App from './App';
const position={reporter_iso3:'USA',counterpart_iso3:'JPN',value_usd:1000000,period:'2025-S2',source_id:'test-only',record_id:'test-1'};
const snapshot={countries:[],positions:[position],sources:[],metadata:{concept:'position',asset_class:'equity',unit_verified:true,period:'2025-S2',version:'test-only'}};
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
describe('atlas interface',()=>{
 it('keeps complete geometry and ISO search when API is empty',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('status')?{ok:true,json:async()=>({state:'empty'})}:{ok:false,status:503}));
  const {container}=render(<App/>);
  await screen.findByText('No data connection.');
  expect(container.querySelectorAll('path.country')).toHaveLength(177);
  expect(container.querySelectorAll('path.holding-arc')).toHaveLength(0);
  expect(screen.getByText('249 searchable entries')).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText('Search name or ISO code…'),{target:{value:'Vatican'}});
  expect(screen.getByText('1 searchable entries')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/外汇/}));
  expect(screen.getByText('SOURCE NOT CONNECTED')).toBeTruthy();
  expect(container.querySelectorAll('path.country')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:/Explore stock-market/}));
  expect(container.querySelectorAll('path.country')).toHaveLength(177);
 });
 it('filters country holdings, labels unavailable drilldowns and clears edges after errors',async()=>{
  let failed=false;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('status')?{ok:true,json:async()=>({state:'ready'})}:failed?{ok:false,status:503}:{ok:true,json:async()=>snapshot}));
  const {container}=render(<App/>);
  await waitFor(()=>expect(container.querySelectorAll('path.holding-arc')).toHaveLength(1));
  fireEvent.change(screen.getByLabelText('Country / territory'),{target:{value:'USA'}});
  expect(screen.getByText('Industry / sector')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Relationship'),{target:{value:'issued_by'}});
  expect(container.querySelectorAll('path.holding-arc')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'Reset view ↗'}));
  expect(container.querySelectorAll('path.holding-arc')).toHaveLength(1);
  failed=true;fireEvent.click(screen.getByRole('button',{name:'Refresh data'}));
  await screen.findByText('No data connection.');
  expect(container.querySelectorAll('path.holding-arc')).toHaveLength(0);
  expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
 });
 it('reuses an ETag snapshot on 304 but never reuses it after source error',async()=>{
  let calls=0;let sourceError=false;
  const fetcher=vi.fn(async(url:string,options?:RequestInit)=>{
   if(url.endsWith('status'))return {ok:true,json:async()=>({state:sourceError?'error':'ready',error:sourceError?'Refresh failed':null})};
   calls++;if(calls>1){expect(options?.headers).toEqual({'If-None-Match':'"test-only"'});return {status:304,ok:false}}
   return {ok:true,status:200,headers:new Headers({'ETag':'"test-only"'}),json:async()=>snapshot};
  });
  vi.stubGlobal('fetch',fetcher);const {container}=render(<App/>);
  await waitFor(()=>expect(container.querySelectorAll('path.holding-arc')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button',{name:'Refresh data'}));
  await waitFor(()=>expect(calls).toBe(2));
  expect(container.querySelectorAll('path.holding-arc')).toHaveLength(1);
  sourceError=true;fireEvent.click(screen.getByRole('button',{name:'Refresh data'}));
  await screen.findByText('No data connection.');
  expect(container.querySelectorAll('path.holding-arc')).toHaveLength(0);
  expect(calls).toBe(2);
 });

 it('retains stale observations with overdue warning and itemized exclusion reasons',async()=>{
  const excluded={...snapshot,metadata:{...snapshot.metadata,excluded_records:{negative_position_not_supported:15},adapter_version:'test'}};
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('status')?{ok:true,json:async()=>({state:'stale',last_success:'2026-11-01T00:00:00Z'})}:{ok:true,status:200,json:async()=>excluded}));
  const {container}=render(<App/>);
  await screen.findByText('源检查已逾期 · Source check overdue.');
  await waitFor(()=>expect(container.querySelectorAll('path.holding-arc')).toHaveLength(1));
  expect(screen.getByText(/negative_position_not_supported: 15/)).toBeTruthy();
 });

});
