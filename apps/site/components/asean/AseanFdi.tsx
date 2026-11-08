'use client';
import React,{useEffect,useState} from 'react';
import {REFRESH_MS,MAX_CACHE_AGE_MS,replySchema,visibleSnapshot,type FdiReply,type FdiCell} from '@/lib/asean/model';
import {HOSTS,SECTORS,YEARS,SOURCE_ATTRIBUTION} from '@/lib/asean/dimensions';
import {fdiSelection,fdiSelectionUrl} from '@/lib/asean/selection';
import FdiHeatmap from './FdiHeatmap';
import {cellText,cellExplanation,yearCells,yearMaximum} from './matrix';
import SourceNotes from './SourceNotes';
import s from './asean.module.css';
import {useReport} from '@/components/markets/useReport';
const parseReply=(value:unknown):FdiReply=>replySchema.parse(value);
const timestamp=(t:string|null)=>t?t.replace('T',' ').replace('Z',' UTC'):'未提供';
export default function AseanFdi(){
 const {reply:data,loading,failure,now,refresh,coolingDown}=useReport('/api/v1/asean/fdi/snapshot',parseReply,REFRESH_MS);
 const [year,setYear]=useState<number>(2025),[host,setHost]=useState(''),[selected,setSelected]=useState<{sector:string;host:string}|null>(null);
 const [selectionWarning,setSelectionWarning]=useState('');
 useEffect(()=>{
  const sync=()=>{
   const selection=fdiSelection(window.location.search);
   setHost(selection.host);setYear(selection.year);setSelected(null);
   setSelectionWarning([selection.invalidCountry?'国家参数不在已核验的 11 个接收国代码内，显示全部接收国。':'',selection.invalidYear?'年份参数不在 2017–2025 范围内，已选择 2025 查询；不代表已有观测。':''].filter(Boolean).join(' '));
  };
  sync();window.addEventListener('popstate',sync);
  return()=>window.removeEventListener('popstate',sync);
 },[]);
 function choose(nextHost:string,nextYear:number){
  setHost(nextHost);setYear(nextYear);setSelected(null);setSelectionWarning('');
  const url=fdiSelectionUrl(window.location.href,nextHost,nextYear);
  if(url.href!==window.location.href)window.history.pushState({},'',url);
  window.dispatchEvent(new Event('atlas-country-change'));
 }
 const snapshot=visibleSnapshot(data,now),denied=data?.status.state==='denied',stale=!!snapshot&&(failure==='network'||data?.status.state==='stale'||now-Date.parse(snapshot.fetched_at)>REFRESH_MS);
 const cells=snapshot?yearCells(snapshot,year):[],maximum=yearMaximum(cells),shown=cells.filter(c=>!host||c.host===host),known=shown.filter(c=>c.state==='reported').length,duplicate=shown.filter(c=>c.state==='duplicate').length;
 const detail=selected?cells.find(c=>c.host===selected.host&&c.sector===selected.sector&&(!host||c.host===host)):null;
 const select=(c:FdiCell)=>setSelected({sector:c.sector,host:c.host});
 return <div className={s.surface}><main className={s.root}>
 <header className={s.header}><a href="/markets">◉ Finance Flow Atlas</a><span>年度跨境直接投资</span></header>
 <section className={s.intro}><p className={s.eyebrow}>ASEANSTATS / ECONOMIC SECTORS</p><h1>东盟 · FDI 行业矩阵</h1><p className={s.subtitle}>11 个接收国／地区代码 × 20 个经济行业分类 · 2017–2025 年度</p><p className={s.notice}>这是真实的年度净流入直接投资（FDI），包括股权资本、再投资收益及公司间债务。它不是股票交易资金流、基金申赎或实时行情。正值为净流入，负值为净撤出／逆向流动；并非流入减对外投资。</p></section>
 <section className={s.status} aria-live="polite"><div><strong>{failure==='permission'?'展示权限已失效':denied?'来源访问已停止':loading&&!snapshot?'正在读取 ASEANstats 公开报告':snapshot?stale?'已保留报告 · 获取缓存陈旧':'年度报告已校验':'暂无可验证的年度行业报告'}</strong><p>{failure==='permission'?'已清空浏览器证据并停止检查。':failure==='invalid'?'响应未通过校验，已清空浏览器证据。':denied?'来源拒绝访问后停止自动请求，不切换接口。':failure==='network'?'连接失败，仅保留仍在期限内的已校验报告。':'公开网站无需账户。最多每日检查一次；获取时间不等于数据观察年度或官方发布时间。'}</p>{coolingDown&&!denied&&failure!=='permission'&&<p>正在等待下次允许检查；手动检查和恢复可见不会提前请求。</p>}{data?.status.error_code&&<small>{data.status.error_code}</small>}</div><button onClick={()=>void refresh()} disabled={loading||coolingDown||denied||failure==='permission'}>{loading?'正在检查…':'检查报告'}</button></section>
 <div className={s.times}><span>当前观察年度<b>{year}</b></span><span>官网更新日期（核验时观察）<b>2026-07-01</b></span><span>来源实际发布时间<b>接口未提供</b></span><span>最近成功获取<b>{timestamp(snapshot?.fetched_at??data?.status.fetched_at??null)}</b></span></div>
 <div className={s.controls}><label>观察年份<select value={year} onChange={e=>choose(host,Number(e.target.value))}>{[...YEARS].reverse().map(y=><option value={y} key={y}>{y}</option>)}</select></label><label>接收国<select value={host} onChange={e=>choose(e.target.value,year)}><option value="">全部国家</option>{HOSTS.map(h=><option value={h.code} key={h.code}>{h.label}</option>)}</select></label><span>单位：百万美元</span></div>
 {selectionWarning&&<p role="status" className={s.notice}>{selectionWarning}</p>}
 {host&&<p className={s.notice}><a href={`/markets?country=${HOSTS.find(country=>country.code===host)!.iso3}`}>返回{HOSTS.find(country=>country.code===host)!.label}国家证据 →</a> · 当前为接收地口径的 {year} 年度 FDI，不是当地证券交易资金流。</p>}
 {snapshot&&<p className={s.coverage}><strong>{known} / {shown.length}</strong> 格有唯一数值 · {shown.filter(c=>c.state==='source_na').length} 格来源 n.a · {duplicate} 格重复隔离 · {shown.filter(c=>c.state==='missing').length} 格未返回。缺失不补零，不计算全行业或全地区总额。</p>}
 <FdiHeatmap cells={cells} year={year} maximum={maximum} host={host} onSelect={select}/>
 {detail&&<section className={s.detail} aria-live="polite" aria-label="选中 FDI 单元格"><button className={s.close} aria-label="关闭单元格详情" onClick={()=>setSelected(null)}>关闭</button><p>{year} · {HOSTS.find(h=>h.code===detail.host)!.label} · {detail.sector}</p><h3>{SECTORS.find(g=>g.code===detail.sector)!.label}</h3><strong className={s.bigValue}>{cellText(detail)}{detail.state==='reported'&&<small> 百万美元</small>}</strong><p>{cellExplanation(detail)}</p><p className={s.raw}>来源原始值：{detail.raw_values.length?detail.raw_values.join(' / '):'无记录'}</p>{detail.host==='PH'&&<p className={s.warning}>菲律宾：行业分项仅含净股权资本，再投资收益与债务工具列在未指定行业 Z；不能直接与其他国家的完整行业 FDI 比较。</p>}{detail.host==='SG'&&<p className={s.warning}>新加坡：专业、科研与技术活动 M 包含行政和支持服务活动 N；不可把这两格当作独立完整行业进行合计。</p>}{detail.sector==='Z'&&<p className={s.warning}>未指定行业 Z 包括保密数据；不是一个可与具体产业等同的经济行业。</p>}</section>}
 <SourceNotes/>
 <footer className={s.footer}><p>{SOURCE_ATTRIBUTION}</p><p>本应用自行翻译标签、隔离重复项并设置热力颜色，属于本应用处理结果，不是 ASEANstats 发布或背书的可视化。技术说明核验于 2026-11-05；截至该次核验的可选年份固定为 2017–2025。缓存超过 {MAX_CACHE_AGE_MS/86_400_000} 天停止展示，年度本身不被误标为实时数据。</p></footer>
 </main></div>;
}
