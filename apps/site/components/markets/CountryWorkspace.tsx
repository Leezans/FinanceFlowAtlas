'use client';
import React, {lazy, Suspense} from 'react';
import {CountryEvidence} from '@/components/navigation/EvidenceContext';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {marketName, marketRoutes, type Market} from './model';
import s from './markets.module.css';

const AshareWorkspace = lazy(() => import('@/components/ashare/AshareWorkspace'));
const TaiwanMoney = lazy(() => import('./TaiwanMoney'));
const JapanMoney = lazy(() => import('./JapanMoney'));
const CvmFunds = lazy(() => import('@/components/cvm/CvmFunds'));

/** One selected economy, one own-market source. Never substitute a TIC counterparty. */
export default function CountryWorkspace({market}: {market: Market}) {
  const route = marketRoutes[market.iso3];
  return <section className={s.countryWorkspace} aria-label={`${marketName(market)}自身市场证据`} key={market.iso3}>
    <div className={s.countryHeading}>
      <div><span>{market.iso3} · {market.region}</span><h2>{marketName(market)} · 本地市场</h2></div>
      <span className={s.metricTag}>{route?.frequency ?? '尚无已接入来源'}</span>
    </div>
    <p className={s.countryScope}>{route?.scope ?? '尚无已接入、可核验的本地市场净买卖数据。该国资金金额保持空白，不用它与美国的交易、价格涨跌、持仓变化或模拟数值代替。'}</p>
    {route && <dl className={s.sourceFacts}>
      <div><dt>指标</dt><dd>{route.metric}</dd></div><div><dt>单位</dt><dd>{route.unit}</dd></div>
      <div><dt>更新</dt><dd>{route.frequency}</dd></div><div><dt>行业 / 个股</dt><dd>{route.drilldown}</dd></div>
    </dl>}
    <Suspense fallback={<p className={s.loading} role="status">正在打开{marketName(market)}的独立来源矩阵…</p>}>
      {market.iso3 === 'CHN' ? <AshareWorkspace embedded/> : market.iso3 === 'TWN' ? <TaiwanMoney/> : market.iso3 === 'JPN' ? <JapanMoney/> : market.iso3 === 'BRA' ? <CvmFunds embedded/> :
        <MatrixHeatmap groups={[]} title={`${marketName(market)} · 资金流行业矩阵`} colorMeaning="暂无可核验方向，不着色。" areaMeaning="暂无可核验金额，不分配面积。" emptyTitle="该市场资金流尚未接入" emptyMessage="缺少符合要求的本地净买卖金额、来源时点或行业分类时，保留空矩阵。国家索引不等于数据覆盖。" emptyNote="全市场每笔成交同时有买方与卖方；净买卖必须注明投资者类别或订单分类口径。"/>}
    </Suspense>
    <CountryEvidence country={market.iso3}/>
  </section>;
}
