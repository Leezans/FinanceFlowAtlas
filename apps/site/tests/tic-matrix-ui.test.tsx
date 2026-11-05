// @vitest-environment jsdom
import React from 'react';
import {afterEach, describe, it, expect, vi} from 'vitest';
import {render, screen, waitFor, fireEvent, cleanup, within} from '@testing-library/react';
import TicLayer from '../components/atlas/TicLayer';
import {ticFixture} from './ticTestFixture';
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
function dataFetch() {vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ok: true, status: 200, headers: new Headers(), json: async () => url.endsWith('/status') ? {state: 'available'} : ticFixture})));}
const tiles = (container: HTMLElement) => container.querySelectorAll('.tic-matrix [data-id]');
describe('shared global country matrix', () => {
 it('defaults to readable grouped tiles and supports regional/country drilldown and breadcrumb back', async () => {
  dataFetch(); const {container} = render(<TicLayer/>);
  await waitFor(() => expect(tiles(container)).toHaveLength(3));
  expect(screen.getByRole('tab', {name: '矩阵热力图'}).getAttribute('aria-selected')).toBe('true');
  expect(container.querySelector('[data-layout=readable-grid]')).toBeTruthy();
  expect(container.querySelectorAll('.tic-arc')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', {name: '进入区域 欧洲'}));
  expect(tiles(container)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', {name: /欧洲 · United Kingdom · -3 USD/}));
  expect(screen.getByRole('article', {name: 'TIC country evidence'}).textContent).toContain('-3 USD millions');
  fireEvent.click(screen.getByRole('button', {name: '全部已报告国家'}));
  expect(tiles(container)).toHaveLength(3);
 });
 it('switches palettes without changing values, signs or scale and keeps geography secondary', async () => {
  dataFetch(); const {container} = render(<TicLayer/>);
  await waitFor(() => expect(tiles(container)).toHaveLength(3));
  const negative = container.querySelector('[data-id=GBR]')!;
  expect(negative.getAttribute('data-color')).toBe('negative-2');
  fireEvent.change(screen.getByLabelText('净交易正负配色'), {target: {value: 'global'}});
  expect(screen.getByRole('region', {name: '美国股权跨境净交易矩阵'}).getAttribute('data-palette')).toBe('global');
  expect(negative.getAttribute('data-color')).toBe('negative-2');
  fireEvent.click(screen.getByRole('button', {name: '净卖出'}));
  expect(container.querySelector('[data-id=GBR]')?.getAttribute('data-color')).toBe('negative-2');
  fireEvent.click(screen.getByRole('tab', {name: '地理地图'}));
  await waitFor(()=>expect(container.querySelectorAll('.tic-arc')).toHaveLength(1));
  expect(tiles(container)).toHaveLength(0);
  fireEvent.click(screen.getByRole('tab', {name: '矩阵热力图'}));
  expect(tiles(container)).toHaveLength(1);
 });
 it('clears tiles and inspected evidence after failure, then recovers without fabricating missing values', async () => {
  let failed = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/status') ? {ok: true, json: async () => ({state: 'available'})} : failed ? {ok: false, status: 503} : {ok: true, status: 200, headers: new Headers(), json: async () => ticFixture}));
  const {container} = render(<TicLayer/>);
  await waitFor(() => expect(tiles(container)).toHaveLength(3));
  fireEvent.mouseEnter(container.querySelector('[data-id=GBR]')!);
  failed = true; fireEvent.click(screen.getByRole('button', {name: 'Refresh TIC data'}));
  await screen.findByText('TIC 数据暂不可用。');
  expect(tiles(container)).toHaveLength(0);
  expect(screen.getByText('TIC 矩阵暂无已验证数据')).toBeTruthy();
  expect(within(screen.getByRole('region', {name: '美国股权跨境净交易矩阵'})).queryByText(/United Kingdom/)).toBeNull();
  failed = false; fireEvent.click(screen.getByRole('button', {name: 'Refresh TIC data'}));
  await waitFor(() => expect(tiles(container)).toHaveLength(3));
 });
 it('shows true zero as a neutral tile with keyboard-accessible country evidence', async () => {
  dataFetch(); const {container} = render(<TicLayer/>);
  await waitFor(() => expect(tiles(container)).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', {name: '零净额'}));
  expect(tiles(container)).toHaveLength(1);
  const zero = container.querySelector('[data-id=CAN]')!;
  expect(zero.getAttribute('data-color')).toBe('zero');
  fireEvent.keyDown(zero, {key: 'Enter'});
  expect(screen.getByRole('article', {name: 'TIC country evidence'}).textContent).toContain('0 USD millions');
 });
 it('keeps issuer-total history lazy and independent of the primary matrix', async () => {
  dataFetch(); const {container} = render(<TicLayer/>);
  await waitFor(() => expect(tiles(container)).toHaveLength(3));
  expect(screen.queryByRole('region', {name: '美国股权境外净交易历史'})).toBeNull();
  expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith('/history'))).toBe(false);
  fireEvent.click(screen.getByText('美国发行人总计历史 · 独立于国家矩阵'));
  await screen.findByRole('region', {name: '美国股权境外净交易历史'});
  expect(tiles(container)).toHaveLength(3);
 });
});
