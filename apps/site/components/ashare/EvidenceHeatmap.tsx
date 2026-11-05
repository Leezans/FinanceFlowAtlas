"use client";
import React,{useState} from 'react';
import {type Scope,type EvidenceRow,type ValidEvidence,coverage,numeric,signedCny,scopeKey,selectEvidenceRows,exactAmount,type FlowFilter,type EvidenceSort} from './model';
import type {EvidenceState} from './client';
import {flowScaleMaximum} from './heatmap';
import {evidenceMatrixGroup} from './matrix';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import './styles.css';
export type Props={state:EvidenceState;onIndustrySelect?:(scope:Scope,row:EvidenceRow)=>void};
export default function EvidenceHeatmap({state,onIndustrySelect}:Props){if(!state.snapshot||state.status==='error'||state.status==='blocked'||state.status==='empty')return <MatrixHeatmap groups={[]} title="A 股行业矩阵" description="行业 → 成分股 · 供应商订单分类主力净额" areaMeaning="可用时按主力净额绝对值" colorMeaning="可用时红色净买入 / 绿色净卖出；当前无数值" emptyTitle={state.recovery?.code==='collection_in_progress'?'A股完整分页核对中':state.recovery?.code==='source_outcome_unconfirmed'?'A股上次采集结果待核查':state.recovery?.mode==='stopped'?'A股来源检查已停止':'A股矩阵暂无可核验数据'} emptyMessage={state.message||'数据未接入；不会生成模拟区块。'}/>;const s=state.snapshot;// Preserve exploration across same-scope polling, but reset when the industry changes.
 const identity=scopeKey(s.scope);return <Heatmap key={identity} snapshot={s} retainedAfterFailure={state.retainedAfterFailure} retainedDuringCollection={state.retainedDuringCollection} onIndustrySelect={onIndustrySelect}/>}
function Heatmap({snapshot:s,onIndustrySelect,retainedAfterFailure,retainedDuringCollection}:{snapshot:ValidEvidence;retainedAfterFailure?:boolean;retainedDuringCollection?:boolean;onIndustrySelect?:Props['onIndustrySelect']}){
 const [selected,setSelected]=useState<string|null>(null),[query,setQuery]=useState(''),[palette,setPalette]=useState<'china'|'global'>('china');
 const [filter,setFilter]=useState<FlowFilter>('all'),[sort,setSort]=useState<EvidenceSort>('magnitude');
 const scopeRows=selectEvidenceRows(s.rows,query,filter,sort);const stats=coverage({...s,rows:scopeRows});
 const chosen=s.rows.find(r=>r.f12===selected);
 const scaleMaximum=flowScaleMaximum(s.rows);
 const industry=s.scope.kind==='industry_rank';
 const pick=(row:EvidenceRow)=>{if(industry){onIndustrySelect?.({kind:'industry_stocks',fs:`b:${row.f12}`,classification_level:'unknown_may_mix_levels'},row)}else setSelected(row.f12)};
 return <section className={`evidence-heatmap palette-${palette}`}><header><div><h2>{industry?'A 股行业矩阵':'行业成分股矩阵'} · 主力净额</h2><p>资金观测时间与来源延迟尚未验证</p></div><select aria-label="正负配色" value={palette} onChange={e=>setPalette(e.target.value as 'china'|'global')}><option value="china">红正 / 绿负</option><option value="global">绿正 / 红负</option></select></header>
 {retainedDuringCollection&&<p className="warning" role="status">新一轮完整分页仍在核对；暂时保留上次完整快照，不是最新行情。部分分页不进入矩阵。</p>}
 {retainedAfterFailure&&<p className="warning" role="status">本次刷新失败；保留浏览器内上次核对完整的快照，不是最新行情。采集时间未更新。</p>}
 {s.stale&&!retainedAfterFailure&&!retainedDuringCollection&&<p className="warning" role="status">服务器已标记缓存陈旧{s.has_error?'且有刷新错误':''}；只展示此带标记快照，行情日期仍未知。</p>}
 <div className="semantics">面积按主力净额绝对值，颜色区分净买与净卖。单位：人民币。供应商订单分类估算，非市场新增资金。</div><div className="tools"><input aria-label="搜索代码或名称" value={query} onChange={e=>{setQuery(e.target.value);setSelected(null)}} placeholder="供应商代码 / 名称"/><label>主力净额方向 <select aria-label="主力净额方向" value={filter} onChange={e=>{setFilter(e.target.value as FlowFilter);setSelected(null)}}><option value="all">全部</option><option value="positive">净买入</option><option value="negative">净卖出</option><option value="zero">已报告零值</option><option value="missing">未提供</option></select></label><span>{palette==='china'?'红正 / 绿负':'绿正 / 红负'}；零值与缺失见明细。</span></div>
 {scaleMaximum>0&&<div className="flow-legend" aria-label="主力净额颜色刻度">
  <div className="flow-legend-heading"><span>净卖出 ← 主力净额 → 净买入</span><span>越亮，绝对净额越大</span></div>
  <div className="flow-legend-ramp" aria-hidden="true">{[-3,-2,-1,1,2,3].map(band=><span key={band} className={band<0?'negative':'positive'} data-flow-strength={Math.abs(band)}/>)}</div>
  <div className="flow-legend-values"><span>{signedCny(-scaleMaximum).replace(' CNY',' 元')}</span><span>0</span><span>{signedCny(scaleMaximum).replace(' CNY',' 元')}</span></div>
  <p>正负各三档，按来源范围最大绝对净额的 1/3、2/3 分界；搜索与方向筛选不重标色阶。</p>
 </div>}
 <MatrixHeatmap
  title="当前筛选范围的主力净额矩形热力图"
  groups={[evidenceMatrixGroup(s,scopeRows)]}
  areaMeaning="主力净额绝对值（人民币），仅当前筛选范围"
  colorMeaning={palette==='china'?'红色净买入 / 绿色净卖出':'绿色净买入 / 红色净卖出'}
  scopeKey={scopeKey(s.scope)} colorPalette={palette} colorMaxAbs={scaleMaximum} showDetails={false} selectedItemId={selected??undefined}
  emptyTitle={scopeRows.length?'没有已报告的非零面积':'没有匹配的行业或股票。'}
  emptyMessage={scopeRows.length?'零值与缺失仍可在数值明细中查看。':'可清空搜索或选择全部方向。'}
  onSelect={!industry||onIndustrySelect?(item)=>{const row=scopeRows.find(row=>row.f12===item.id);if(row)pick(row)}:undefined}
 />
 <div className="coverage" aria-live="polite"><span>面积分母 {stats.nonzero.length?signedCny(stats.denominator).replace(/^\+/,''):'—'}，仅当前筛选行绝对值之和。</span><span>显示 {scopeRows.length} / 来源 {s.source_total}；非零 {stats.nonzero.length} / 零 {stats.zero.length} / 缺失 {stats.missing.length}</span></div>
 <details className="evidence-list" aria-label="完整数值明细">
  <summary>数值明细 · {scopeRows.length} 项（含零值与缺失）</summary>
  <div className="list-heading">
   <label>排序 <select aria-label="明细排序" value={sort} onChange={event=>setSort(event.target.value as EvidenceSort)}>
    <option value="magnitude">净额绝对值从大到小</option><option value="net_desc">净买入最多优先</option><option value="net_asc">净卖出最多优先</option><option value="name">名称</option>
   </select></label>
  </div>
  <p>包含零值与缺失项。主力净额显示原值，单位为元；面积占比只对当前筛选的非零绝对值计算，不是全市场份额。</p>
  <div className="table-scroll" role="region" aria-label="可横向滚动的数值明细" tabIndex={0}>
   <table aria-label={industry?'行业主力净额明细':'成分股主力净额明细'}>
    <thead><tr><th scope="col">名称 / 供应商代码</th><th scope="col">主力净额（元）</th><th scope="col">状态</th><th scope="col">涨跌幅</th><th scope="col">面积占比</th>{(!industry||onIndustrySelect)&&<th scope="col">查看</th>}</tr></thead>
    <tbody>{scopeRows.map(row=>{
     const amount=numeric(row.f62),priceReturn=numeric(row.f3);
     return <tr key={row.f12} data-code={row.f12} data-selected={!industry&&selected===row.f12?'true':undefined}>
      <th scope="row">{row.f14}<small>{row.f12}</small></th>
      <td className={amount===null||amount===0?'neutral':amount>0?'positive':'negative'}>{exactAmount(amount)}</td>
      <td>{amount===null?'未提供，不是零':amount===0?'已报告零值':amount>0?'净买入':'净卖出'}</td>
      <td>{priceReturn===null?'未提供':`${exactAmount(priceReturn)}%`}</td>
      <td>{amount===null?'—（缺失）':amount===0?'—（零值）':`${(Math.abs(amount)/stats.denominator*100).toFixed(2)}%`}</td>
      {(!industry||onIndustrySelect)&&<td><button type="button" aria-label={industry?`进入${row.f14}的成分股`:`查看${row.f14}的原始证据`} aria-pressed={!industry?selected===row.f12:undefined} onClick={()=>pick(row)}>{industry?'进入成分股':'原始证据'}</button></td>}
     </tr>;
    })}</tbody>
   </table>
   {!scopeRows.length&&<p className="empty-list">没有匹配项。可清空搜索或选择全部方向。</p>}
  </div>
 </details>
 {chosen&&<article aria-label="股票原始证据">{!scopeRows.some(row=>row.f12===chosen.f12)&&<p role="status">所选股票已不符合当前筛选，仍显示其最新来源记录。</p>}<h3>{chosen.f14} · 供应商代码 {chosen.f12}</h3><p>f62：{exactAmount(numeric(chosen.f62))} 元；f3：{numeric(chosen.f3)===null?'未提供':`${exactAmount(numeric(chosen.f3))}%`}；未推断交易所MIC。</p><button type="button" onClick={()=>setSelected(null)}>关闭原始证据</button></article>}
 <details><summary>来源与范围说明</summary><p>来源范围：{s.scope.fs} · {s.scope.classification_level}；主力净额字段 f62，涨跌幅字段 f3。</p><p>f2 报价口径：{industry?'行业指数（点），不是股票价格或资金金额':'成分股价格（人民币元）'}。</p><p>分类成员互斥性：not_established。不宣称完整全市场行业归属，不推导行业总量。</p><p>抓取时间：{s.fetched_at}（不是行情时间）；source_observed_at / trade_date 未提供；page_count={s.page_count}。</p><p>{s.notice}</p><p>行业点击仅在调用者提供范围请求回调时启用；本组件没有请求、权限批准或历史行情功能。</p></details></section>
}
