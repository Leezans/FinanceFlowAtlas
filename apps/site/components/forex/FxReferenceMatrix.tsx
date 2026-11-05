'use client';
import React,{useMemo} from 'react';
import type {FxSnapshot} from '@/lib/fx/model';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {fxReferenceGroups} from './matrix';
import s from './forex.module.css';

type Props={snapshot:FxSnapshot|null;query:string;onQueryChange:(value:string)=>void;loading:boolean};
export default function FxReferenceMatrix({snapshot,query,onQueryChange,loading}:Props){
 const groups=useMemo(()=>fxReferenceGroups(snapshot,query),[snapshot,query]);
 const count=groups.reduce((total,group)=>total+group.items.length,0);
 const emptyMessage=snapshot?'没有匹配的已覆盖货币；缺失不表示零。':loading?'正在读取 ECB 的公开每日 XML…':'尚无通过校验的参考汇率。检查成功后显示真实来源数据，不使用样例填补。';
 return <section className={s.matrixSection} aria-label="外汇参考矩阵工作区">
  {snapshot&&<div className={s.matrixToolbar}><p>来源实际覆盖 {snapshot.rates.length} 种报价币 · 当前显示 {count} 种</p><div><label htmlFor="fx-search">筛选货币</label><input id="fx-search" placeholder="CNY、美元…" value={query} onChange={event=>onQueryChange(event.target.value)}/></div></div>}
  <MatrixHeatmap groups={groups} title="外汇参考汇率矩阵" description="每个区块是一种来源报价币，直接保留 ECB 数字精度。EUR 为基准，不添加虚构涨跌。" areaMeaning="每种货币等面积；不代表规模、成交量或资金流" colorMeaning="中性色：单日参考值不提供涨跌，不比较不同币种的面值大小" colorMode="neutral" layout="readable-grid" emptyTitle={snapshot?"没有匹配的报价币":loading?"正在检查参考汇率":"参考汇率暂不可用"} emptyMessage={emptyMessage} emptyNote="只展示来源已核验的参考值；没有历史数据就不计算涨跌。"/>
 </section>;
}
