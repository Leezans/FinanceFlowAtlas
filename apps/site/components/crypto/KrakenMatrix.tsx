'use client';
import React,{useMemo,useState} from 'react';
import type {KrakenSnapshot} from '@/lib/crypto/kraken';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {cryptoColorMaximum,cryptoMatrixGroups,cryptoMetrics,formatDeviation,type CryptoMetric} from './matrix';
import s from './crypto.module.css';

type Props={snapshot:KrakenSnapshot|null};
export default function KrakenMatrix({snapshot}:Props){
 const [metric,setMetric]=useState<CryptoMetric>('last_price_usd');
 const groups=useMemo(()=>cryptoMatrixGroups(snapshot,metric),[snapshot,metric]);
 const maximum=useMemo(()=>cryptoColorMaximum(snapshot),[snapshot]);
 const selected=cryptoMetrics.find(item=>item.id===metric)!;
 const priceView=metric==='last_price_usd';
 return <section className={s.matrixSection} aria-label="加密货币矩阵工作区">
  <div className={s.metricControls} role="group" aria-label="选择矩阵指标">{cryptoMetrics.map(item=><button type="button" key={item.id} aria-pressed={metric===item.id} onClick={()=>setMetric(item.id)}>{item.label}</button>)}</div>
  <MatrixHeatmap groups={groups} title={`加密货币现货矩阵 · ${selected.label}`} description="BTC/USD 与 ETH/USD，Kraken 单一交易所。切换指标查看价格、成交均价、成交量和笔数。" areaMeaning="每个交易对等面积；不代表市值或资金流" colorMeaning={priceView?`最近价相对 24h 成交均价的计算偏离；红=高于，绿=低于；本快照色阶上限 ${formatDeviation(maximum)}。不是 24h 涨跌或资金流`:'中性色：只展示所选原始指标，不推算涨跌或资金流'} colorMode={priceView?'signed':'neutral'} colorMaxAbs={maximum} emptyTitle="现货行情暂不可用" emptyNote="只展示通过校验且未过期的两组现货行情；缺失不是零。" emptyMessage="只有两组交易对均通过校验才展示。无初始快照、过期、拒绝访问或格式异常都不会替换成示例行情。"/>
  <p className={s.matrixNote}>资金净流入：此来源不提供。未平仓量（OI）：现货不适用。不同币种成交量不合计，最近价相对均价的偏离由本页计算，不是来源发布的涨跌幅。</p>
 </section>;
}
