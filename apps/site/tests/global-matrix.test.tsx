// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import Markets from '../components/markets/Markets';
import {ticFixture} from './ticTestFixture';
beforeEach(() => {window.history.replaceState({}, '', '/markets');});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
function dataFetch() {vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ok: true, status: 200, headers: new Headers(), json: async () => url.endsWith('/status') ? {state: 'available'} : ticFixture})));}
describe('matrix-first global market page', () => {
 it('leads with actual grouped TIC evidence and explicitly separate source scopes', async () => {
  dataFetch(); const {container} = render(<Markets/>);
  await waitFor(() => expect(container.querySelectorAll('.tic-matrix details [data-id]')).toHaveLength(3));
  const matrix = screen.getByRole('region', {name: '美国股权跨境净交易矩阵'});
  expect(matrix.textContent).toContain('3 个已报告居住地；非全球完整覆盖');
  expect(screen.getByRole('region', {name: '矩阵来源与口径边界'}).textContent).toContain('其他资产、币种与频率不拼成一个全球净流入数字');
  expect(screen.queryByRole('group', {name: '选择国家或地区；小型地区也可通过搜索选择'})).toBeNull();
  expect((fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => url)).toEqual(['/api/v1/flows/tic/status', '/api/v1/flows/tic']);
  expect(screen.getByRole('link', {name: '巴西 · 月度基金交易'}).getAttribute('href')).toBe('/brazil');
  fireEvent.click(screen.getByText('地理导航与市场入口'));
  expect(await screen.findByRole('group', {name: '选择国家或地区；小型地区也可通过搜索选择'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: '选择 中国 (CHN)'}));
  expect(screen.getByRole('link', {name: /进入 A 股/})).toBeTruthy();
  expect(container.querySelectorAll('.tic-matrix details [data-id]')).toHaveLength(3);
 });
 it('renders a true empty source canvas without country-index placeholders', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({state: 'unavailable', error: 'Not verified'})})));
  const {container} = render(<Markets/>);
  await screen.findByText('TIC 数据暂不可用。');
  expect(screen.getByText('TIC 矩阵暂无已验证数据')).toBeTruthy();
  expect(container.querySelectorAll('.tic-matrix details [data-id]')).toHaveLength(0);
  expect(container.querySelector('[data-matrix-empty=true]')).toBeTruthy();
 });
 it('preserves direct country URLs and back navigation without mixing geography into observations', async () => {
  dataFetch(); window.history.replaceState({}, '', '/markets?country=BRA'); render(<Markets/>);
  expect(await screen.findByRole('link', {name: /进入巴西基金/})).toBeTruthy();
  window.history.replaceState({}, '', '/markets?country=FRA'); fireEvent(window, new PopStateEvent('popstate'));
  expect(screen.queryByRole('link', {name: /进入巴西基金/})).toBeNull();
  expect(screen.getByText('暂无可下钻的行业 / 个股视图')).toBeTruthy();
  await waitFor(()=>expect(document.querySelector('g[data-id=JPN]')).toBeTruthy());
 });
});
