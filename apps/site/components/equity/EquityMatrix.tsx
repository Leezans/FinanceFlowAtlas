'use client';
import React, {useMemo, useState} from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import type {EquityMetric, EquitySnapshot} from '@/lib/equity/model';
import {annualUsd, EQUITY_METRICS, equityCountries, equityRegions, projectEquityMatrix} from '@/lib/equity/matrix';
import s from './equity.module.css';

type Props = {snapshot: EquitySnapshot | null; loading: boolean; onSelect: (iso3: string) => void};
export default function EquityMatrix({snapshot, loading, onSelect}: Props) {
  const [metric, setMetric] = useState<EquityMetric>('capitalization');
  const [region, setRegion] = useState('');
  const projection = useMemo(() => projectEquityMatrix(snapshot, metric, region), [snapshot, metric, region]);
  const year = projection.year;
  const count = projection.groups.reduce((total, group) => total + group.items.length, 0);
  const label = EQUITY_METRICS.find(item => item.key === metric)!.label;
  return <section className={s.comparison} aria-label="同年国家市场比较">
    <div className={s.toolbar}>
      <div><h2>区域 → 国家 / 地区</h2><p>每项指标仅比较最新可用年度。灰色缺失格只是地理索引，不代表来源有数据。</p></div>
      <div className={s.filters}>
        <label>比较指标<select aria-label="比较指标" value={metric} onChange={event => setMetric(event.target.value as EquityMetric)}>{EQUITY_METRICS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label>区域<select aria-label="筛选区域" value={region} onChange={event => setRegion(event.target.value)}><option value="">全部区域</option>{equityRegions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </div>
    </div>
    <p className={s.coverage}>{year ?? '—'} 年 · {projection.observed} 个国家 / 地区有{label}观测 · {equityCountries.length} 个地理索引不等于数据覆盖。当前区域 {count} 格，其中 {projection.displayedObserved} 格有观测。</p>
    <MatrixHeatmap groups={projection.groups} title="全球股市年度矩阵" layout="readable-grid" colorMode="sequential" colorMaxAbs={projection.maximum}
      description={`${label} · ${year ?? '未核验'} · 当年美元（USD）。点击国家查看两项指标各自的最近观测。`}
      areaMeaning="国家等面积；不代表市值占比或完整全球总额"
      colorMeaning="蓝色越亮，所选年度数值越大；不表示涨跌或资金流入。灰格区分零与缺失"
      emptyTitle={loading ? '正在检查年度股市数据' : '年度股市矩阵暂无可核验数据'}
      emptyMessage="只有官方响应通过国家、年份、指标、单位和完整分页校验后才显示矩阵数值。"
      emptyNote="市值与成交额都不是净资本流量；未核验时不生成国家热力块。"
      onSelect={item => onSelect(item.id)}/>
    {projection.observed > 0 && <div className={s.legend} aria-label="年度规模颜色标尺">
      <span><i data-band="missing"/>所选年无观测</span><span><i data-band="zero"/>实报零</span>
      {projection.maximum > 0 && [1, 2, 3].map(band => <span key={band}><i data-band={band}/>{annualUsd(projection.maximum * (band - 1) / 3)}–{annualUsd(projection.maximum * band / 3)}</span>)}
    </div>}
    <p className={s.scope}>来源适配器保留三年窗口内各指标最近非空观测，不提供历史年度选择。某国最近观测年份与所选年度不同就保留缺失，不混入旧值。颜色标尺按该年度全部实报国家固定，筛选区域不改变标尺。</p>
  </section>;
}
