'use client';
import React,{useEffect,useState} from 'react';
import {geoNaturalEarth1,geoPath,geoGraticule10} from 'd3-geo';
import {feature} from 'topojson-client';
import type {Topology,GeometryCollection} from 'topojson-specification';
import type {FeatureCollection,Geometry} from 'geojson';
import topology from 'world-atlas/countries-110m.json';
import {markets,marketName,marketRoutes,searchMarkets,type Market} from './model';
import s from './markets.module.css';
const shapes=feature(topology as unknown as Topology,topology.objects.countries as unknown as GeometryCollection) as FeatureCollection<Geometry>;
const projection=geoNaturalEarth1().fitExtent([[20,20],[980,510]],{type:'Sphere'}),path=geoPath(projection);
const byNumeric=new Map(markets.map(m=>[m.numeric,m]));
const mappedCount=new Set(shapes.features.map(f=>byNumeric.get(String(f.id).padStart(3,'0'))?.iso3).filter(Boolean)).size;
function locationMarket(){return markets.find(m=>m.iso3===new URLSearchParams(window.location.search).get('country'))||null}
export default function GeographicNavigator(){
 const [selected,setSelected]=useState<Market|null>(null),[query,setQuery]=useState(''),[hovered,setHovered]=useState('');
 useEffect(()=>{const sync=()=>{setSelected(locationMarket());setQuery('')};sync();window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync)},[]);
 function select(m:Market|null){setSelected(m);setQuery('');setHovered('');const url=new URL(window.location.href);if(m)url.searchParams.set('country',m.iso3);else url.searchParams.delete('country');window.history.pushState({},'',url)}
 const route=selected?marketRoutes[selected.iso3]:undefined;
 const results=query.trim()?searchMarkets(query):[];
 return <section className={s.geography} aria-label="全球国家与地区导航">
  <div className={s.workspace}>
   <section className={s.mapCard} aria-label="全球市场地图">
    <div className={s.mapToolbar}><div className={s.breadcrumb}><button onClick={()=>select(null)}>全球</button>{selected&&<><span>/</span><strong>{marketName(selected)}</strong></>}</div><button className={s.reset} onClick={()=>select(null)}>重置视图 ↺</button></div>
    <div className={s.searchWrap}><label htmlFor="market-search" className={s.searchLabel}>查找国家或地区</label><input id="market-search" placeholder="搜索中国、日本、France、US…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setQuery('');if(e.key==='Enter'&&results.length===1)select(results[0])}} autoComplete="off"/>
     {query.trim()&&<div className={s.results} aria-label="国家搜索结果">{results.length?results.map(m=><button key={m.iso3} onClick={()=>select(m)}><span>{marketName(m)}</span><small>{m.name} · {m.iso3}</small></button>):<p>未找到匹配项。试试英文名称或 ISO 代码。</p>}</div>}
    </div>
    <svg className={s.map} viewBox="0 0 1000 530" role="group" aria-label="选择国家或地区；小型地区也可通过搜索选择">
     <path d={path({type:'Sphere'})||''} className={s.ocean}/><path d={path(geoGraticule10())||''} className={s.grid}/>
     {shapes.features.map((f,i)=>{const m=byNumeric.get(String(f.id).padStart(3,'0'));return <path key={`${f.id}-${i}`} d={path(f)||''} className={`${s.country} ${selected?.iso3===m?.iso3&&m?s.selected:''}`} role={m?'button':undefined} tabIndex={m?0:undefined} aria-label={m?`选择 ${marketName(m)} (${m.iso3})`:undefined} aria-pressed={m?selected?.iso3===m.iso3:undefined} onClick={()=>m&&select(m)} onKeyDown={e=>{if(m&&(e.key==='Enter'||e.key===' ')){e.preventDefault();select(m)}}} onMouseEnter={()=>setHovered(m?marketName(m):'地图边界未对应检索条目')} onMouseLeave={()=>setHovered('')}><title>{m?marketName(m):String(f.properties?.name||'未匹配地区')}</title></path>})}
    </svg>
    <div className={s.mapFooter}><span>{hovered||'点击地图，探索一个市场'}</span><span><i/> 蓝色仅表示选择，不表示资金涨跌</span></div>
    <div className={s.quick}><span>快捷定位</span><button onClick={()=>select(markets.find(m=>m.iso3==='CHN')!)}>中国 A 股 <b>↗</b></button><button onClick={()=>select(markets.find(m=>m.iso3==='USA')!)}>美国 · TIC 补充层 <b>↗</b></button></div>
   </section>
   <aside className={s.panel} aria-live="polite" aria-atomic="true" aria-label="所选市场证据">
    <p className={s.eyebrow}>{selected?`${selected.iso3} / ${selected.region}`:'YOUR NEXT LEVEL'}</p>
    <h2>{selected?marketName(selected):'选择你的起点'}</h2><p className={s.english}>{selected?selected.name:'A world of markets. Evidence first.'}</p>
    <div className={s.journey}><span className={s.stepActive}>全球</span><i>→</i><span className={selected?s.stepActive:''}>市场</span><i>→</i><span>行业</span><i>→</i><span>个股</span></div>
    {!selected?<><p className={s.body}>从地图或搜索进入。每个市场只展示实际存在的证据入口，缺失的数据不会被当成零。</p><div className={s.emptyVisual} aria-hidden="true"><span>◎</span><span>◌</span><span>◌</span></div><p className={s.caption}>A 股、台股上柜与巴西公开基金有独立矩阵入口。美国 TIC 是跨境补充层；每个来源的实际覆盖与新鲜度请进入后查看。</p></>:<>
     <div className={s.status}>{route?'已实现页面 · 实时状态未在此核验':'尚无已实现的市场页面'}</div>
     <h3>{route?.metric||'行业与个股资金证据待接入'}</h3><p className={s.body}>{route?.scope||'此处仅提供地理定位。尚无可供展示的、已核验的本地市场行业与个股资金数据；不使用价格、持仓或模拟值替代。'}</p>
     <dl className={s.facts}><div><dt>观测期</dt><dd>未在导航页加载</dd></div><div><dt>频率</dt><dd>{route?.frequency||'未接入'}</dd></div><div><dt>单位</dt><dd>{route?.unit||'未核验，不展示金额'}</dd></div><div><dt>新鲜度</dt><dd>未核验；进入来源页查看</dd></div></dl>
     {route?<a className={s.cta} href={route.href}>{route.label}<span>→</span></a>:<div className={s.unavailable}>暂无可下钻的行业 / 个股视图</div>}
     <details className={s.details} key={selected.iso3}><summary>来源与口径限制</summary>{route&&<p><a href={route.reference} target="_blank" rel="noreferrer">查看{route.sourceLabel} ↗</a></p>}<p><a href="https://data.imf.org/Datasets/BOP" target="_blank" rel="noreferrer">IMF BOP 官方参考 ↗</a></p><p>BOP 是国际收支投资组合权益交易，不是本地股票行业流向。货币单位仍为 review_required，导航页不展示金额，也不宣称该地区有观测数据。</p>{selected.iso3==='USA'&&<p>TIC 的外国交易对手居住地不等于股票发行人所属行业。不可将跨境交易分摊成行业或个股资金流。</p>}</details>
    </>}
   </aside>
  </div>
  <section className={s.assetLinks} aria-label="独立跨资产资料"><div><strong>外汇 · 每日参考汇率</strong><span>欧洲央行公开来源；汇率参考，不是资金流或实时交易报价。</span></div><a href="/forex">查看 ECB 外汇参考 →</a></section>
  <div className={s.quick}><span>独立资产证据</span><a href="/futures">期货 · 美国 CFTC 持仓报告 ↗</a><a href="/crypto">虚拟货币 · Kraken 单一交易所现货 ↗</a></div>

  <footer className={s.footer}><p>{markets.length} 个可检索国家 / 地区 · {mappedCount} 个检索条目有对应地图多边形。小型地区请使用搜索。地图面积与颜色均不代表资金金额。</p><details><summary>地图来源与边界说明</summary><p>Natural Earth / world-atlas 2.0.2；名称与地区索引来自 iso-codes、world-countries。地图仅作示意，不表达主权立场。<a href="/geography/ATTRIBUTION.txt" target="_blank" rel="noreferrer">完整归属与许可 ↗</a></p></details></footer>
 </section>
}
