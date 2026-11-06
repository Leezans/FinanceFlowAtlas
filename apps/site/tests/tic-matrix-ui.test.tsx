// @vitest-environment jsdom
import React from 'react';
import {afterEach, describe, it, expect, vi} from 'vitest';
import {render, screen, waitFor, fireEvent, cleanup} from '@testing-library/react';
import TicLayer from '../components/atlas/TicLayer';
import {ticFixture} from './ticTestFixture';
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
function dataFetch() {vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ok: true, status: 200, headers: new Headers(), json: async () => url.endsWith('/status') ? {state: 'available'} : ticFixture})));}
const tiles = (container: HTMLElement) => container.querySelectorAll('.tic-matrix details [data-id]');
describe('shared global country matrix', () => {
 it('defaults to monetary grouped tiles and supports regional/country drilldown and breadcrumb back', async () => {
  dataFetch(); const {container} = render(<TicLayer/>);
  await waitFor(() => expect(tiles(container)).toHaveLength(3));
  expect(screen.getByRole('tab', {name: '矩阵热力图'}).getAttribute('aria-selected')).toBe('true');
  expect(container.querySelector('[data-layout=treemap]')).toBeTruthy();
  expect(container.querySelectorAll('.tic-arc')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', {name: '进入区域 欧洲'}));
  expect(tiles(container)).toHaveLength(1);
  fireEvent.click(container.querySelector('g[data-id=GBR]')!);
  expect(screen.getByRole('article', {name: 'TIC country evidence'}).textContent).toContain('-3 USD millions');
  fireEvent.click(screen.getByRole('button', {name: '全部已报告国家'}));
  expect(tiles(container)).toHaveLength(3);
 });
 it('resets zoom on region, country, breadcrumb and sign changes, but preserves palette changes', async () => {
  dataFetch(); const {container} = render(<TicLayer/>);
  await waitFor(() => expect(tiles(container)).toHaveLength(3));
  const zoom = () => fireEvent.click(screen.getByRole('button', {name: '放大矩阵'}));
  const scale = () => container.querySelector('.tic-matrix [data-zoom]')?.getAttribute('data-zoom');
  zoom(); expect(scale()).toBe('1.5');
  fireEvent.change(screen.getByLabelText('净交易正负配色'), {target: {value: 'global'}});
  expect(scale()).toBe('1.5');
  fireEvent.click(screen.getByRole('button', {name: '进入区域 欧洲'})); expect(scale()).toBe('1');
  zoom(); fireEvent.click(container.querySelector('g[data-id=GBR]')!); expect(scale()).toBe('1');
  zoom(); fireEvent.click(screen.getByRole('button', {name: '全部已报告国家'})); expect(scale()).toBe('1');
  zoom(); fireEvent.click(screen.getByRole('button', {name: '净卖出'})); expect(scale()).toBe('1');
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
 it('retains verified tiles and evidence on transient failure without fabricating missing values', async () => {
  let failed = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/status') ? {ok: true, status:200, headers:new Headers(), json: async () => ({state: 'available'})} : failed ? {ok: false, status: 503, headers:new Headers()} : {ok: true, status: 200, headers: new Headers(), json: async () => ticFixture}));
  const {container} = render(<TicLayer/>);
  await waitFor(() => expect(tiles(container)).toHaveLength(3));
  fireEvent.mouseEnter(container.querySelector('[data-id=GBR]')!);
  failed = true; fireEvent.click(screen.getByRole('button', {name: 'Refresh TIC data'}));
  await screen.findByText('TIC 数据暂不可用。');
  expect(tiles(container)).toHaveLength(3);
  expect(screen.queryByText('TIC 矩阵暂无已验证数据')).toBeNull();
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
  expect(container.querySelector('g[data-id=CAN]')).toBeNull();
  fireEvent.click(screen.getByText(/数值明细 · 全部 1 项/));
  fireEvent.click(zero);
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
