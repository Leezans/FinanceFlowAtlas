"use client";
import React, {useMemo} from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {projectTicMatrix, regionName} from '@/lib/tic/matrix';
import type {TicSnapshot} from '@/lib/tic/model';

type Props = {
  snapshot: TicSnapshot | null;
  country: string;
  region: string;
  sign: string;
  palette: 'global' | 'china';
  onCountry: (iso: string) => void;
  onRegion: (region: string) => void;
};

/** Source controls compose the common renderer; all financial projection is pure. */
export default function TicMatrix({snapshot, country, region, sign, palette, onCountry, onRegion}: Props) {
  const matrix = useMemo(() => projectTicMatrix(snapshot, {country, region, sign}), [snapshot, country, region, sign]);
  const selected = snapshot?.country_flows.find(row => row.foreign_economy_iso3 === country);
  function selectRegion(next: string) { onCountry(''); onRegion(next); }
  return <section className="tic-matrix" aria-label="TIC 区域与国家矩阵">
    <nav className="tic-matrix-breadcrumb" aria-label="国家矩阵路径">
      <button onClick={() => selectRegion('')}>全部已报告国家</button>
      {region && <><span>›</span><button onClick={() => selectRegion(region)}>{regionName(region)}</button></>}
      {selected && <><span>›</span><span>{selected.foreign_economy_name}</span></>}
    </nav>
    <div className="tic-matrix-regions" role="group" aria-label="按区域筛选">
      {matrix.regions.map(item => <button key={item.id} aria-pressed={region === item.id}
        aria-label={`进入区域 ${item.label}`} onClick={() => selectRegion(item.id)}>{item.label} · {item.count}</button>)}
    </div>
    <MatrixHeatmap groups={matrix.groups} title="美国股权跨境净交易矩阵"
      description={`${snapshot?.period ?? '月份未取得'} · U.S. Treasury TIC · 月度，非实时 · ${matrix.reportedCountries} 个已报告居住地；非全球完整覆盖`}
      colorMeaning={`${palette === 'china' ? '红' : '绿'}为净买入，${palette === 'china' ? '绿' : '红'}为净卖出；灰为已报告零；同月统一色阶`}
      areaMeaning="国家面积按同月净交易金额绝对值（USD）；区域面积为各国绝对值之和，不是市值" colorPalette={palette}
      colorMaxAbs={matrix.colorMaxAbs} layout="treemap"
      scopeKey={JSON.stringify([snapshot?.period, country, region, sign])}
      emptyTitle={snapshot ? '当前筛选没有已报告观测' : 'TIC 矩阵暂无已验证数据'}
      emptyMessage={snapshot ? '更换国家、区域或净交易方向查看；未报告的居住地不会补零。' : '等待美国财政部月度来源通过核验；不生成占位资金区块。'}
      emptyNote="只显示境外居民交易美国股权，不代表各国本地市场资金流。"
      onSelect={(item, group) => { onRegion(group.id); onCountry(item.id); }}/>
  </section>;
}
