'use client';
import React from 'react';
import {useEvidenceSource} from './useEvidenceSource';
import {assetLabels, relatedSources, sourcesForCountry, type EvidenceSource} from '@/lib/catalog/sources';
import s from './navigation.module.css';

export function EvidenceLinks({sources}:{sources:readonly EvidenceSource[]}) {
 return <div className={s.related}>{sources.map(source => <a key={source.id} href={source.href}>
  <strong>{source.label}</strong><span>{assetLabels[source.asset]} · {source.geographyRole} · {source.metric}</span>
  <small>{source.unit} · {source.frequency}</small>
 </a>)}</div>;
}
/** Relationships are discovery links, never child totals or claims of fresh data. */
export function CountryEvidence({country}:{country:string}) {
 const sources=sourcesForCountry(country);
 if (!sources.length) return null;
 return <aside className={s.context} aria-label="该市场相关证据">
  <h3>同一国家 / 地区的相关证据</h3><p>按资产类别衔接已有矩阵。切换入口会保留各自口径，不把金额、股数、名义金额或持仓相加。</p>
  <EvidenceLinks sources={sources}/>
 </aside>;
}
export default function EvidenceContext() {
 const source=useEvidenceSource();
 if(!source) return null;
 return <aside className={s.context} aria-label="当前数据层级与口径">
  <nav aria-label="证据层级"><a href="/markets">全球市场</a><span> / {assetLabels[source.asset]} / </span>
   {source.country ? <a href={`/markets?country=${source.country}`}>{source.country} · {source.geographyRole}</a> : <span>{source.provider} · {source.geographyRole}（不指定国家）</span>}
   <span> / {source.drilldown}</span></nav>
  <p><strong>{source.metric}</strong> · {source.unit} · {source.frequency} · 来源：{source.provider}</p>
  <details><summary>关联矩阵与口径边界</summary><p>{source.boundary} 具体观测期、采集时间与可用状态以矩阵内证据为准，入口存在不代表数据可用。</p>
   <EvidenceLinks sources={relatedSources(source)}/>
  </details>
 </aside>;
}
