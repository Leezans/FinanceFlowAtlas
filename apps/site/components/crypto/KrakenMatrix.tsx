'use client';
import React,{useMemo,useState} from 'react';
import type {KrakenSnapshot} from '@/lib/crypto/kraken';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {cryptoColorMaximum,cryptoMatrixGroups,cryptoMetrics,formatDeviation,type CryptoMetric} from './matrix';
import s from './crypto.module.css';

type Props={snapshot:KrakenSnapshot|null};
export default function KrakenMatrix({snapshot}:Props){
 const [metric,setMetric]=useState<CryptoMetric>('last_price_usd'),[query,setQuery]=useState('');
 const groups=useMemo(()=>cryptoMatrixGroups(snapshot,metric,query),[snapshot,metric,query]);
 const maximum=useMemo(()=>cryptoColorMaximum(snapshot),[snapshot]);
 const selected=cryptoMetrics.find(item=>item.id===metric)!;
 const priceView=metric==='last_price_usd';
 return <section className={s.matrixSection} aria-label="加密货币矩阵工作区">
  <div className={s.metricControls} role="group" aria-label="选择矩阵指标">{cryptoMetrics.map(item=><button type="button" key={item.id} aria-pressed={metric===item.id} onClick={()=>setMetric(item.id)}>{item.label}</button>)}</div>
  <div className={s.matrixSearch}><label>查找交易对 <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="BTC / ETH / SOL…" aria-label="查找加密货币交易对"/></label><span>{snapshot?`已核验 ${snapshot.rows.length} / ${snapshot.universe_pair_count} 组 USD 现货交易对`:'等待核验交易对目录与行情'}</span></div>
  {snapshot?.missing.length? <div className={s.matrixNote} role="status">部分覆盖：{snapshot.missing.length} 组缺失或未通过行情校验，未显示为零。<details><summary>查看缺失交易对</summary>{snapshot.missing.map(item=><span key={item.pair}>{item.pair}（{item.reason==='missing_ticker'?'无行情':'行情未通过校验'}） </span>)}</details></div>:null}
  <MatrixHeatmap layout="readable-grid" stretchSmallGroups groups={groups} title={`加密货币现货矩阵 · ${selected.label}`} description="Kraken 单一交易所、USD 报价的在线现货交易对。按官方目录纳入，不推断行业分类；可搜索并在矩阵内滚动查看。" areaMeaning="无可比较金额：价格、币数量与笔数不用于金额面积；交易对等面积" colorMeaning={priceView?`最近价相对 24h 成交均价的计算偏离；红=高于，绿=低于；本快照色阶上限 ${formatDeviation(maximum)}。不是 24h 涨跌或资金流`:'中性色：只展示所选原始指标，不推算涨跌或资金流'} colorMode={priceView?'signed':'neutral'} colorMaxAbs={maximum} emptyTitle={snapshot?"没有匹配的交易对":"现货行情暂不可用"} emptyNote="只展示通过校验且未过期的现货行情；缺失不是零。" emptyMessage={snapshot?"请更改搜索词；搜索不会请求其他来源或填入示例行情。":"交易对目录与行情通过校验后展示。无初始快照、过期、拒绝访问或格式异常都不会替换成示例行情。"}/>
  <p className={s.matrixNote}>资金净流入：此来源不提供。未平仓量（OI）：现货不适用。现货币种包括加密资产、稳定币及来源列出的法币对，未另作行业分类。不同币种成交量不合计，最近价相对均价的偏离由本页计算，不是来源发布的涨跌幅。</p>
 </section>;
}
