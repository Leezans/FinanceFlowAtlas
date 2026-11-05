"use client";
import React, {useEffect, useState, lazy, Suspense} from 'react';
import TicLayer from '@/components/atlas/TicLayer';
import {markets} from './model';
import '../atlas/styles.css';
import s from './markets.module.css';

const GeographicNavigator = lazy(() => import('./GeographicNavigator'));

/** Global geography and source evidence remain separate responsibilities. */
export default function Markets() {
  const [geographyOpen, setGeographyOpen] = useState(false);
  useEffect(() => {
    const sync = () => {
      const iso = new URLSearchParams(window.location.search).get('country');
      setGeographyOpen(markets.some(market => market.iso3 === iso));
    };
    sync(); window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return <main className={s.root}>
    <header className={s.header}><a href="/markets" className={s.brand}><span aria-hidden="true">◉</span> Finance Flow Atlas</a><span className={s.headerNote}>全球市场 · 来源独立的矩阵</span></header>
    <section className={s.intro}><div><p className={s.eyebrow}>REGION → REPORTED RESIDENCE</p><h1>全球市场矩阵</h1><p className={s.subtitle}>区域 → 境外居住地。各来源独立展示。</p></div></section>
    <section className={s.sourceScope} aria-label="矩阵来源与口径边界">
      <strong>TIC · 月度 · USD · 美国发行人</strong>
      <span>只绘制来源已报告的国家与地区。其他资产、币种与频率不拼成一个全球净流入数字。</span>
      <nav aria-label="独立来源矩阵"><a href="/ashare">A 股 · 订单分类估算</a><a href="/taiwan">台股上柜 · 法人交易</a><a href="/brazil">巴西 · 月度基金交易</a><a href="/asean">东盟 · 年度 FDI</a></nav>
    </section>
    <div id="global-evidence" className={s.globalEvidence}><TicLayer/></div>
    <details className={s.geographyDisclosure} open={geographyOpen} onToggle={event => setGeographyOpen(event.currentTarget.open)}>
      <summary>地理导航与市场入口 <span>{markets.length} 个国家 / 地区索引，不代表数据覆盖</span></summary>
      {geographyOpen && <Suspense fallback={<p role="status">正在打开国家与地区导航…</p>}><GeographicNavigator/></Suspense>}
    </details>
  </main>;
}
