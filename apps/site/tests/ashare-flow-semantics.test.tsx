// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import EvidenceHeatmap from '../components/ashare/EvidenceHeatmap';
import {emptyState,type EvidenceState} from '../components/ashare/client';
import {validateEvidence} from '../components/ashare/model';
import {evidenceMatrixGroup} from '../components/ashare/matrix';
import {marketRoutes} from '../components/markets/model';

const methodology='https://emdesk.eastmoney.com/pc_activity/Pages/VIPTrade/pages/link/zjl.html';
function state(stocks=false):EvidenceState{
 const snapshot=validateEvidence({schema:'ashare-provider-evidence/1',rows:[{f12:stocks?'000001':'BK0001',f14:'合成口径测试',f2:9,f3:3,f62:-10.25,f184:null,f66:1000,f69:null,f72:2000,f75:null,f78:7,f81:null,f84:9,f87:null}],source_total:1,fetched_at:'2026-11-06T02:00:00.000Z',scope:stocks?{kind:'industry_stocks',fs:'b:BK0001',classification_level:'unknown_may_mix_levels'}:{kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'},page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:stocks?'CNY':'index_points'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'Synthetic fixture only',stale:false,has_error:false});
 return {snapshot,etag:'synthetic',status:'ready',message:''};
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('explicit supplier main-flow scope',()=>{
 it.each([false,true])('explains the limited metric before the industry/stock matrix (stocks=%s)',stocks=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<EvidenceHeatmap state={state(stocks)}/>);
  const note=screen.getByRole('note',{name:'主力净额计算口径'});
  expect(note.closest('details')).toBeNull();
  const matrixHeading=screen.getByRole('heading',{name:stocks?'行业成分股矩阵 · 主力净额':'A 股行业矩阵 · 主力净额'});expect(note.compareDocumentPosition(matrixHeading)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(note.textContent).toContain('东方财富');expect(note.textContent).toContain('f62');expect(note.textContent).toContain('人民币');
  expect(note.textContent).toContain('超大单净额 + 大单净额');expect(note.textContent).toContain('不包含中单、小单');
  expect(note.textContent).toContain('不是个股或全市场所有交易资金的净流入');expect(note.textContent).toContain('不等于新增入市资金');expect(note.textContent).toContain('不能据此识别具体机构');
  expect(within(note).getByRole('link',{name:'东方财富资金流说明'}).getAttribute('href')).toBe(methodology);expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getAllByText(/主力净额 -10.25 元/).length).toBeGreaterThan(0);
 });
 it.each(['empty','blocked','error'] as const)('keeps methodology visible with no invented observations when state=%s',status=>{
  const {container}=render(<EvidenceHeatmap state={{...emptyState(),status}}/>);
  expect(screen.getByRole('note',{name:'主力净额计算口径'})).toBeTruthy();expect(container.querySelectorAll('g[data-id]')).toHaveLength(0);expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByRole('article')).toBeNull();expect(screen.queryByText(/-10.25/)).toBeNull();
 });
 it('retains both scope and stale warnings without changing source amounts',()=>{
  const original=state(true);const snapshot={...original.snapshot!,stale:true,has_error:true};render(<EvidenceHeatmap state={{...original,snapshot,status:'stale'}}/>);
  expect(screen.getByRole('note',{name:'主力净额计算口径'})).toBeTruthy();expect(screen.getByText(/服务器已标记缓存陈旧且有刷新错误/)).toBeTruthy();
  const item=evidenceMatrixGroup(snapshot,snapshot.rows).items[0];expect(item.amount).toMatchObject({value:-10.25,currency:'CNY'});expect(item.colorValue).toBe(-10.25);expect(item.detail).toContain('非所有交易资金净流入');
  expect(snapshot.source_observed_at).toBeNull();expect(snapshot.trade_date).toBeNull();
 });
 it('links the market directory to the actual supplier methodology, not third-party documentation mislabeled as provider documentation',()=>{
  expect(marketRoutes.CHN.sourceLabel).toBe('东方财富资金流说明');expect(marketRoutes.CHN.reference).toBe(methodology);
  expect(marketRoutes.CHN.scope).toContain('大单与超大单');expect(marketRoutes.CHN.scope).toContain('不是所有交易资金净流入');
 });
});
