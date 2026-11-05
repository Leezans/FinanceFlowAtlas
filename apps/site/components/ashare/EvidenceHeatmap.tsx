"use client";
import React,{useState,useId,useRef,useEffect} from 'react';
import {hierarchy,treemap,treemapSquarify} from 'd3-hierarchy';
import {type Scope,type EvidenceRow,type ValidEvidence,coverage,numeric,signedCny,scopeKey,selectEvidenceRows,exactAmount,type FlowFilter,type EvidenceSort} from './model';
import type {EvidenceState} from './client';
import {flowScaleMaximum,flowStrength,fitTileFont} from './heatmap';
import './styles.css';
export type Props={state:EvidenceState;onIndustrySelect?:(scope:Scope,row:EvidenceRow)=>void};
export default function EvidenceHeatmap({state,onIndustrySelect}:Props){if(!state.snapshot||state.status==='error'||state.status==='blocked'||state.status==='empty')return <section className="evidence-heatmap empty" role="status"><h2>行业 / 股票订单分类证据</h2><p>{state.message||'数据未接入；不会生成模拟区块。'}</p></section>;const s=state.snapshot;// Preserve exploration across same-scope polling, but reset when the industry changes.
 const identity=scopeKey(s.scope);return <Heatmap key={identity} snapshot={s} onIndustrySelect={onIndustrySelect}/>}
function Heatmap({snapshot:s,onIndustrySelect}:{snapshot:ValidEvidence;onIndustrySelect?:Props['onIndustrySelect']}){
 const clipPrefix=useId().replace(/:/g,'');
 const chartRef=useRef<HTMLDivElement>(null);
 const [chartWidth,setChartWidth]=useState(1000);
 useEffect(()=>{
  const chart=chartRef.current;if(!chart)return;
  const measure=()=>{const width=Math.round(chart.clientWidth);if(width>0)setChartWidth(width)};
  measure();
  if(typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(measure);observer.observe(chart);
  return()=>observer.disconnect();
 },[]);
 const chartHeight=Math.max(300,Math.min(540,Math.round(chartWidth*.55)));
 const [selected,setSelected]=useState<string|null>(null),[query,setQuery]=useState(''),[palette,setPalette]=useState<'china'|'global'>('china');
 const [hovered,setHovered]=useState<string|null>(null),[focused,setFocused]=useState<string|null>(null);
 const [filter,setFilter]=useState<FlowFilter>('all'),[sort,setSort]=useState<EvidenceSort>('magnitude');
 const scopeRows=selectEvidenceRows(s.rows,query,filter,sort);const stats=coverage({...s,rows:scopeRows});
 const chosen=s.rows.find(r=>r.f12===selected);
 const inspected=stats.nonzero.find(row=>row.f12===hovered)??stats.nonzero.find(row=>row.f12===focused)??scopeRows.find(row=>row.f12===selected);
 const scaleMaximum=flowScaleMaximum(s.rows);
 type Item={name:string;row?:EvidenceRow;children?:Item[]};
 const tree=treemap<Item>().tile(treemapSquarify).size([chartWidth,chartHeight]).padding(1).round(true)(hierarchy<Item>({name:'scope',children:stats.nonzero.map(row=>({name:row.f14,row}))}).sum(item=>Math.abs(Number(item.row?.f62||0))).sort((a,b)=>(b.value||0)-(a.value||0)));
 const industry=s.scope.kind==='industry_rank';
 const title=(row:EvidenceRow)=>`${row.f14} · ${row.f12} · 主力净额 ${exactAmount(numeric(row.f62))} 元 · 涨跌幅 ${numeric(row.f3)===null?'未提供':`${row.f3}%`} · 供应商订单分类代理，非真实新增资金`;
 const pick=(row:EvidenceRow)=>{if(industry){onIndustrySelect?.({kind:'industry_stocks',fs:`b:${row.f12}`,classification_level:'unknown_may_mix_levels'},row)}else setSelected(row.f12)};
 return <section className={`evidence-heatmap palette-${palette}`}><header><div><h2>{industry?'A股行业':'行业成分股'} · 主力净额</h2><p>行情时间与延迟未提供</p></div><select aria-label="正负配色" value={palette} onChange={e=>setPalette(e.target.value as 'china'|'global')}><option value="china">红正 / 绿负</option><option value="global">绿正 / 红负</option></select></header>
 {s.stale&&<p className="warning" role="status">服务器已标记缓存陈旧{s.has_error?'且有刷新错误':''}；只展示此带标记快照，行情日期仍未知。</p>}
 <div className="semantics">面积按主力净额绝对值，颜色区分净买与净卖。单位：人民币。供应商订单分类估算，非市场新增资金。</div><div className="tools"><input aria-label="搜索代码或名称" value={query} onChange={e=>{setQuery(e.target.value);setSelected(null)}} placeholder="供应商代码 / 名称"/><label>主力净额方向 <select aria-label="主力净额方向" value={filter} onChange={e=>{setFilter(e.target.value as FlowFilter);setSelected(null)}}><option value="all">全部</option><option value="positive">净买入</option><option value="negative">净卖出</option><option value="zero">已报告零值</option><option value="missing">未提供</option></select></label><span>{palette==='china'?'红正 / 绿负':'绿正 / 红负'}；零值与缺失见明细。</span></div>
 {scaleMaximum>0&&<div className="flow-legend" aria-label="主力净额颜色刻度">
  <div className="flow-legend-heading"><span>净卖出 ← 主力净额 → 净买入</span><span>越亮，绝对净额越大</span></div>
  <div className="flow-legend-ramp" aria-hidden="true">{[-3,-2,-1,1,2,3].map(band=><span key={band} className={band<0?'negative':'positive'} data-flow-strength={Math.abs(band)}/>)}</div>
  <div className="flow-legend-values"><span>{signedCny(-scaleMaximum).replace(' CNY',' 元')}</span><span>0</span><span>{signedCny(scaleMaximum).replace(' CNY',' 元')}</span></div>
  <p>正负各三档，按来源范围最大绝对净额的 1/3、2/3 分界；搜索与方向筛选不重标色阶。</p>
 </div>}
 <div className="chart" ref={chartRef}>{stats.nonzero.length?<svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="group" aria-label="当前筛选范围的主力净额矩形热力图">{tree.leaves().map(tile=>{
  const row=tile.data.row!,w=tile.x1-tile.x0,h=tile.y1-tile.y0,canSelect=!industry||!!onIndustrySelect;
  const large=w>=140&&h>=100,medium=w>=65&&h>=46;
  const name=industry||large?row.f14:row.f12;
  const amount=signedCny(Number(row.f62)).replace(' CNY','');
  const nameFont=fitTileFont(name,w,large?27:15),amountFont=fitTileFont(amount,w,large?22:13);
  const cx=(tile.x0+tile.x1)/2,cy=(tile.y0+tile.y1)/2,clipId=`${clipPrefix}-${row.f12}`;
  return <g key={row.f12} clipPath={`url(#${clipId})`} className={`tile ${Number(row.f62)>0?'positive':'negative'}`} data-code={row.f12} data-flow-strength={flowStrength(Number(row.f62),scaleMaximum)} data-selected={selected===row.f12?'true':undefined} role={canSelect?'button':'img'} tabIndex={0} aria-label={title(row)} onMouseEnter={()=>setHovered(row.f12)} onMouseLeave={()=>setHovered(null)} onFocus={()=>{setHovered(null);setFocused(row.f12)}} onBlur={()=>setFocused(null)} onClick={canSelect?()=>pick(row):undefined} onKeyDown={canSelect?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(row)}}:undefined}>
   <title>{title(row)}</title><defs><clipPath id={clipId}><rect x={tile.x0} y={tile.y0} width={w} height={h}/></clipPath></defs>
   <rect className="tile-body" x={tile.x0} y={tile.y0} width={w} height={h}/>
   {w>=42&&h>=25&&nameFont>=9&&<text className="tile-name" x={cx} y={cy-(large?20:medium?7:-4)} textAnchor="middle" fontSize={nameFont}>{name}</text>}
   {medium&&amountFont>=9&&<text className="tile-amount" x={cx} y={cy+12} textAnchor="middle" fontSize={amountFont}>{amount}</text>}
   {large&&<text className="tile-secondary" x={cx} y={cy+36} textAnchor="middle" fontSize={fitTileFont(`${row.f12} · 主力净额`,w,12)}>{row.f12} · 主力净额</text>}
  </g>
 })}</svg>:<p className="no-area">{scopeRows.length?'没有已报告的非零面积；零值与缺失仍可在明细中查看。':'没有匹配的行业或股票。'}</p>}</div>
 <div className="tile-inspector" role="region" aria-label="区块数值预览">
  {inspected?<><div className="inspection-identity"><strong>{inspected.f14}</strong><span>{inspected.f12}</span></div><dl>
   <div><dt>主力净额（元）</dt><dd className={numeric(inspected.f62)===null||inspected.f62===0?'neutral':Number(inspected.f62)>0?'positive':'negative'}>{exactAmount(numeric(inspected.f62))}</dd></div>
   <div><dt>涨跌幅</dt><dd>{numeric(inspected.f3)===null?'未提供':`${exactAmount(numeric(inspected.f3))}%`}</dd></div>
   <div><dt>当前面积占比</dt><dd>{numeric(inspected.f62)===null?'—（缺失）':inspected.f62===0?'—（零值）':`${(Math.abs(Number(inspected.f62))/stats.denominator*100).toFixed(2)}%`}</dd></div>
  </dl></>:<p>指向区块或用 Tab 聚焦，查看精确净额、涨跌幅与面积占比。{industry&&onIndustrySelect?'点击行业进入成分股。':!industry?'点击股票固定原始证据。':''}</p>}
 </div>
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
 <details><summary>来源与范围说明</summary><p>来源范围：{s.scope.fs} · {s.scope.classification_level}；主力净额字段 f62，涨跌幅字段 f3。</p><p>分类成员互斥性：not_established。不宣称完整全市场行业归属，不推导行业总量。</p><p>抓取时间：{s.fetched_at}（不是行情时间）；source_observed_at / trade_date 未提供；page_count={s.page_count}。</p><p>{s.notice}</p><p>行业点击仅在调用者提供范围请求回调时启用；本组件没有请求、权限批准或历史行情功能。</p></details></section>
}
