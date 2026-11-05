'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- Plain links avoid prefetching gated source pages. */
import React, {useEffect, useMemo, useState} from 'react';
import {INDICATORS, SOURCE, LICENSE} from '@/lib/equity/model';
import {equityCountries, equityCountryName, projectCountryEquity} from '@/lib/equity/matrix';
import {useEquitySnapshot} from '@/hooks/useEquitySnapshot';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import EquityMatrix from './EquityMatrix';
import s from './equity.module.css';

const time = (value: string | null) => value ? value.replace('T', ' ').replace('Z', ' UTC') : '未提供';
export default function EquityContext() {
  const {data, snapshot, loading, failure, stale, denied, refresh} = useEquitySnapshot();
  const [selected, setSelected] = useState('USA');
  useEffect(() => {
    const sync = () => {
      const code = new URLSearchParams(window.location.search).get('country');
      setSelected(equityCountries.some(country => country.iso3 === code) ? code! : 'USA');
    };
    sync(); window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  function select(code: string) {
    setSelected(code);
    const url = new URL(window.location.href); url.searchParams.set('country', code);
    if (url.href !== window.location.href) window.history.pushState({}, '', url);
  }
  const countryGroups = useMemo(() => projectCountryEquity(snapshot, selected), [snapshot, selected]);
  return <main className={s.root}>
    <header className={s.header}><a href="/markets">◉ Finance Flow Atlas</a><a href="/#tic-view">美国 TIC 跨境流量 ↗</a></header>
    <section className={s.intro}>
      <p className={s.eyebrow}>GLOBAL EQUITIES / WORLD BANK · WFE</p><h1>全球股市，年度规模矩阵。</h1>
      <p className={s.subtitle}>年末市值与全年成交额 · 官方开放数据 · 无需账户或密钥</p>
      <p className={s.notice}>这是年度市场规模与交易活跃度，不是实时行情、行业净买入或资金净流入。没有可靠的行业 / 个股流量时，不用估计值填充。</p>
    </section>
    <section className={s.status} aria-live="polite">
      <div><strong>{failure === 'permission' ? '展示权限已失效' : denied ? '来源访问已停止' : loading && !snapshot ? '正在读取世界银行数据' : snapshot ? stale ? '已保留数据 · 获取状态陈旧' : '已取得可核验的年度数据' : '暂无可核验的年度数据'}</strong>
        <p>{failure === 'permission' ? '已清空浏览器数据并停止检查。' : failure === 'invalid' ? '响应未通过校验，已清空浏览器数据。' : denied ? '来源拒绝后停止请求，不切换其他路径。' : failure === 'network' ? '连接失败。仅保留七天以内已校验的获取缓存。' : '每天最多获取一次。获取时间不等于观测年份或数据发布时间。'}</p>
        {data?.status.error_code && <small>{data.status.error_code}</small>}
      </div><button disabled={loading || denied || failure === 'permission'} onClick={() => void refresh()}>{loading ? '正在检查…' : '检查数据'}</button>
    </section>
    <EquityMatrix snapshot={snapshot} loading={loading} onSelect={select}/>
    <section className={s.countrySelect}>
      <label htmlFor="equity-country">选择国家 / 地区</label>
      <select id="equity-country" value={selected} onChange={event => select(event.target.value)}>{equityCountries.map(country => <option key={country.iso3} value={country.iso3}>{country.label} · {country.iso3}</option>)}</select>
      <button onClick={() => select('USA')}>美国优先 ↗</button>
    </section>
    <section className={s.focus} aria-label="所选国家年度股市">
      <div className={s.focusHeader}><div><p className={s.eyebrow}>{selected} / ANNUAL EQUITY CONTEXT</p><h2>{equityCountryName(selected)}</h2></div><a href={`/markets?country=${selected}`}>返回国家证据 →</a></div>
      <MatrixHeatmap groups={countryGroups} title="所选国家年度指标矩阵" layout="readable-grid" stretchSmallGroups colorMode="neutral"
        areaMeaning="指标等面积；市值是存量，成交额是全年累计"
        colorMeaning="中性色；不同指标、不同年份不共用大小或涨跌色标"
        emptyTitle="国家年度指标待核验" emptyMessage="当前没有可展示的来源快照。缺失不是零。" emptyNote="不将年度市场规模解释为资金净流入。"/>
      <p className={s.scope}>总市值覆盖上市本国公司，排除投资基金等。成交额含本国与外国股票，单边计数。两项范围不同，不相减推算流量。</p>
      {selected === 'USA' && <a className={s.usLink} href="/">查看美国真实月度跨境股票净买入：Treasury TIC →</a>}
    </section>
    <section className={s.sources}>
      <h2>口径、时间与授权</h2>
      <dl><div><dt>查询年度窗口</dt><dd>{snapshot ? `${snapshot.window_start}–${snapshot.window_end}` : '等待来源验证'}</dd></div><div><dt>数据集更新时间</dt><dd>{snapshot?.dataset_updated ?? '未提供'}（不是逐条发布时间）</dd></div><div><dt>最近成功获取</dt><dd>{time(snapshot?.fetched_at ?? data?.status.fetched_at ?? null)}</dd></div><div><dt>逐条实际发布时间</dt><dd>接口未提供</dd></div></dl>
      <ul>
        <li>World Bank：World Development Indicators；原始来源 World Federation of Exchanges（WFE）。两项指标均标注 CC BY 4.0。此页面由 FinanceFlowAtlas 筛选和可视化，不代表来源机构认可。</li>
        <li>市值是股价乘已发行股数的年末存量；全年成交额是实际成交股数乘对应成交价格的单边总额。两者都没有识别买卖双方资金流向。</li>
        <li>来源说明以对应年末汇率换算为当年美元。不同市场的上市、交易范围和覆盖可能不同，不合并为完整全球总额。</li>
        <li>观测年份、数据集更新时间与获取时间分别展示。获取缓存超过七天停止展示；年度数据不支持推断今天的行情。地区和收入分组等来源汇总项不当作国家。</li>
      </ul>
      <div className={s.links}><a href={SOURCE + INDICATORS.capitalization} target="_blank" rel="noreferrer">市值指标与许可 ↗</a><a href={SOURCE + INDICATORS.traded_value} target="_blank" rel="noreferrer">成交额指标与许可 ↗</a><a href={LICENSE} target="_blank" rel="noreferrer">CC BY 4.0 与世界银行附加条款 ↗</a></div>
    </section>
  </main>;
}
