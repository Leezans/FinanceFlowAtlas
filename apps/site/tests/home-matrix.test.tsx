// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import App from '../components/atlas/App';
vi.mock('../components/ashare/AshareWorkspace',()=>({default:()=> <section aria-label="A 股行业与个股矩阵工作区">行业矩阵画布</section>}));
vi.mock('../components/atlas/TicLayer',()=>({default:()=> <section aria-label="TIC test layer">居住地矩阵</section>}));
afterEach(()=>{cleanup();window.history.replaceState({},'','/')});
describe('matrix-first homepage',()=>{
 it('opens directly onto the industry matrix, not a list or multiple fetching sources',()=>{
  const {container}=render(<App/>);expect(screen.getByRole('region',{name:'A 股行业与个股矩阵工作区'})).toBeTruthy();
  expect(screen.queryByRole('region',{name:'TIC test layer'})).toBeNull();expect(container.querySelector('table')).toBeNull();
 });
 it('opens, closes and reopens the separate non-industry TIC matrix',async()=>{
  const {container}=render(<App/>);fireEvent.click(screen.getByRole('link',{name:'继续看美国 TIC'}));await screen.findByRole('region',{name:'TIC test layer'});
  const disclosure=container.querySelector('#tic-view') as HTMLDetailsElement;disclosure.open=false;fireEvent(disclosure,new Event('toggle'));
  await waitFor(()=>expect(screen.queryByRole('region',{name:'TIC test layer'})).toBeNull());
  fireEvent.click(screen.getByRole('link',{name:'继续看美国 TIC'}));await screen.findByRole('region',{name:'TIC test layer'});
 });
 it('preserves direct TIC hash links without replacing the industry matrix',async()=>{
  window.history.replaceState({},'','/#tic-view');render(<App/>);await screen.findByRole('region',{name:'TIC test layer'});
  expect(screen.getByRole('region',{name:'A 股行业与个股矩阵工作区'})).toBeTruthy();
 });
});
