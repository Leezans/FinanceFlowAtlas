'use client';
import React, {useEffect, useState, lazy, Suspense} from 'react';
import CountryWorkspace from './CountryWorkspace';
import {markets, marketName, marketRoutes, searchMarkets, type Market} from './model';
import {COUNTRY_CHANGE_EVENT, navigateToMarket, selectedMarket} from './selection';
import '../atlas/styles.css';
import s from './markets.module.css';

const GeographicNavigator = lazy(() => import('./GeographicNavigator'));
const TicLayer = lazy(() => import('@/components/atlas/TicLayer'));
const DEFAULT_COUNTRY = 'CHN';

/** Global entry describes reporting markets, not foreign counterparties of U.S. securities. */
export default function Markets() {
  const [selected, setSelected] = useState<Market|null>(null);
  const [query, setQuery] = useState('');
  const [geographyOpen, setGeographyOpen] = useState(false), [ticOpen, setTicOpen] = useState(false);
  useEffect(() => {
    const sync = () => { setSelected(selectedMarket(DEFAULT_COUNTRY)!); setQuery(''); setTicOpen(window.location.hash === '#us-tic-supplement'); };
    sync(); window.addEventListener('popstate', sync); window.addEventListener(COUNTRY_CHANGE_EVENT, sync); window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener(COUNTRY_CHANGE_EVENT, sync); window.removeEventListener('hashchange', sync); };
  }, []);
  const options = query.trim() ? searchMarkets(query) : markets;
  return <main className={s.root}>
    <header className={s.header}><a href="/markets" className={s.brand}><span aria-hidden="true">◉</span> Finance Flow Atlas</a><span className={s.headerNote}>各国自身市场 · 独立来源</span></header>
    <section className={s.intro}><div><p className={s.eyebrow}>COUNTRY → LOCAL MARKET → INDUSTRY</p><h1>全球市场矩阵</h1><p className={s.subtitle}>选择国家，查看该市场自身的净买卖。来源频率、覆盖与单位分别保留。</p></div></section>
    <section className={s.sourceScope} aria-label="矩阵来源与口径边界">
      <strong>本地市场口径，不以美国为基准</strong>
      <span>净买卖须注明参与者范围。币种、时期与指标不混合；没有全球统一净流入总计。日报、月报不标成实时。</span>
    </section>
    <section className={s.countryControls} aria-label="选择国家自身市场">
      <div className={s.localTabs} role="group" aria-label="已实现的本地来源入口">
        {Object.keys(marketRoutes).map(iso => { const market = markets.find(value => value.iso3 === iso)!; return <button key={iso} aria-pressed={selected?.iso3 === iso} onClick={() => navigateToMarket(market)}>{marketName(market)}<span>{marketRoutes[iso].shortLabel}</span></button>; })}
      </div>
      <div className={s.countrySelect}>
        <label htmlFor="country-filter">搜索国家<input id="country-filter" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="中国、日本、France、US…"/></label>
        <label htmlFor="country-selection">国家 / 地区<select id="country-selection" value={options.some(market => market.iso3 === selected?.iso3) ? selected?.iso3 : ''} onChange={event => {const market = markets.find(value => value.iso3 === event.target.value); if (market) navigateToMarket(market);}}>
          {!options.some(market => market.iso3 === selected?.iso3) && <option value="">{options.length ? '选择搜索结果' : '未找到匹配国家'}</option>}
          {options.map(market => <option key={market.iso3} value={market.iso3}>{marketName(market)} · {market.iso3}{marketRoutes[market.iso3] ? '' : ' · 未接入'}</option>)}
        </select></label>
      </div>
      <p>{markets.length} 个地理索引，{Object.keys(marketRoutes).length} 个已有独立来源入口。入口存在不代表当前数据可用；实际覆盖、时点与访问状态见下方。</p>
    </section>
    <div id="global-evidence" className={s.globalEvidence}>{selected?<CountryWorkspace key={selected.iso3} market={selected}/>:<p className={s.loading} role="status">正在选择本地市场…</p>}</div>
    <p className={s.sourceScope}><a href="/europe">欧洲延迟成交价矩阵</a><span>Cboe BXE 股票及 ETF 的部分分钟窗口，至少延迟 15 分钟；单独查看价格，不填入各国净资金流。</span></p>
    <details className={s.geographyDisclosure} open={geographyOpen} onToggle={event => setGeographyOpen(event.currentTarget.open)}>
      <summary>地理导航与市场入口 <span>{markets.length} 个国家 / 地区索引，不代表数据覆盖</span></summary>
      {geographyOpen && <Suspense fallback={<p role="status">正在打开国家与地区导航…</p>}><GeographicNavigator/></Suspense>}
    </details>
    <details id="us-tic-supplement" className={s.geographyDisclosure} open={ticOpen} onToggle={event => setTicOpen(event.currentTarget.open)}>
      <summary>美国 TIC · 独立跨境补充资料 <span>月度 · 美国发行人 · 不是各国本地资金流</span></summary>
      {ticOpen && <div className={s.globalEvidence}><Suspense fallback={<p role="status">正在打开美国 TIC 补充资料…</p>}><TicLayer/></Suspense></div>}
    </details>
  </main>;
}
