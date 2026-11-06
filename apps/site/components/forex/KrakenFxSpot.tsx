'use client';
import React,{useState} from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {useKrakenEvidence} from '@/components/crypto/useKrakenEvidence';
import KrakenRefreshNotice from '@/components/crypto/KrakenRefreshNotice';
import {visibleTradeSnapshot} from '@/components/crypto/trade-matrix';
import {FX_VENUE_PAIRS,projectFxVenue} from '@/lib/fx/venue';
import {KRAKEN_DOCS,KRAKEN_PAIRS_DOCS} from '@/lib/crypto/kraken';
import {KRAKEN_TRADES_DOCS} from '@/lib/crypto/trades';
import {fxVenueGroups,fxVenueMetrics,type FxVenueMetric} from './venue-matrix';
import s from '@/components/crypto/crypto.module.css';

const timestamp=(value:string|null)=>value?value.replace('T',' ').replace('Z',' UTC'):'未提供';
const missingReason={not_in_online_catalog:'不在当前已验证在线目录',missing_ticker:'缺少报价',invalid_ticker:'报价未通过校验',identity_mismatch:'交易对身份不匹配'};
export default function KrakenFxSpot(){
 const {data,loading,networkError,permissionLost,invalidResponse,now,timeframe,snapshot,age,stale,denied,refresh,applyScope}=useKrakenEvidence(FX_VENUE_PAIRS);
 const [metric,setMetric]=useState<FxVenueMetric>('rate');
 const venue=projectFxVenue(snapshot,visibleTradeSnapshot(data?.trade_snapshot,!!snapshot,now));
 const maximum=Math.max(0,...(venue?.rows.map(row=>Math.abs(row.price_vwap_deviation_pct??0))??[]));
 return <main className={s.root}>
  <header className={s.header}><a href="/markets">◉ Finance Flow Atlas</a><nav aria-label="资产导航"><a href="/markets">全球市场</a><a href="/crypto">加密货币</a></nav></header>
  <section className={s.intro}><p className={s.eyebrow}>FOREX / KRAKEN SPOT</p><h1>外汇，查看日内交易所行情。</h1><p>澳元、欧元、英镑兑美元 · Kraken 单一交易所法币现货</p><p className={s.notice}>页面打开且可见时约每 60 秒检查来源更新，不等待日终或年底。当前仅覆盖这 3 组 USD 报价，不代表全球银行间外汇市场；汇率和成交量不是资金净流入。</p></section>
  <section className={s.status} aria-live="polite" aria-label="外汇行情获取状态"><div><strong>{permissionLost?'展示权限已失效':denied?'来源访问已停止':loading&&!snapshot?'正在获取外汇行情':snapshot?stale?'上次有效快照 · 已陈旧':'已获取交易所快照':'暂无可验证交易所行情'}</strong><p>{permissionLost?'已清空浏览器行情并停止检查。':invalidResponse?'响应未通过校验，已清空行情。':denied?'来源拒绝后停止检查，不更换路径或重置共享限制。':networkError?'本次连接失败，只保留未超过 15 分钟的有效快照。':data?.status.error_code?'本次检查未成功，缺失数据不填零。':'与加密货币页面共用 Kraken 来源门控、冷却和请求预算；页面检查不保证每次重新访问来源。'}</p>{data?.status.error_code&&<code>{data.status.error_code}</code>}</div><button onClick={()=>void refresh()} disabled={loading||denied||permissionLost}>{loading?'正在检查…':'检查更新'}</button></section>
  <KrakenRefreshNotice/>
  <div className={s.times}><span>最近成功获取 <b>{timestamp(venue?.fetched_at??data?.status.fetched_at??null)}</b></span><span>快照年龄 <b>{age===null?'无可展示快照':`${Math.floor(age/1000)} 秒`}</b></span><span>汇率观测时间 / 来源延迟 <b>接口未提供 · 未知</b></span></div>
  <section className={s.matrixSection} aria-label="交易所外汇矩阵工作区"><div className={s.metricControls} aria-label="外汇矩阵指标">{fxVenueMetrics.map(item=><button key={item.id} aria-pressed={metric===item.id} onClick={()=>setMetric(item.id)}>{item.label}</button>)}</div>
   <MatrixHeatmap groups={fxVenueGroups(venue,metric)} title="Kraken 法币现货矩阵" description="每个区块是一组直接交易的法币汇率，不通过加密货币或其他汇率拼接。" areaMeaning="汇率面值和基础币数量不可比较：3 组等面积，不代表资金规模" colorMeaning={metric==='rate'?'最近价相对滚动 24h 成交均价的偏离，不是日涨跌或资金流':'中性色：当前指标不代表方向或资金流'} colorMode={metric==='rate'?'signed':'neutral'} colorMaxAbs={maximum} layout="readable-grid" emptyTitle={loading?'正在读取交易所行情':'交易所外汇行情暂不可用'} emptyMessage="仅显示通过验证且未过期的 Kraken 法币现货报价；不会以 ECB 每日参考值、模拟数据或零值填补。" emptyNote="本页不保证零延迟或全市场覆盖。"/>
   <p className={s.matrixNote}>当前切片 3 组 · 已核验 {venue?.rows.length??0} / 3。{venue?`目录获取：${timestamp(venue.catalog_fetched_at)}。`:''}USD/JPY、USD/CAD、USD/CHF 及其他交叉盘不在本次接入范围。</p>
   {!!venue?.missing.length&&<p className={s.matrixNote}>缺失：{venue.missing.map(row=>`${row.pair}（${missingReason[row.reason]}）`).join('；')}。缺失不代表零或停止交易。</p>}
  </section>
  <fieldset className={s.windowControls} disabled={!!denied||permissionLost}><legend>独立成交时戳证据</legend>{(['1m','5m'] as const).map(window=><label key={window}><input type="radio" name="fx-trade-window" checked={timeframe===window} onChange={()=>applyScope([...FX_VENUE_PAIRS],window)}/>{window==='1m'?'1 分钟':'5 分钟'}</label>)}<p>下方仅列这段固定窗口内返回的成交时刻；不把成交时刻当作上方汇率的观测时间，也不声称它是交易所全市场最新成交。</p></fieldset>
  <section className={s.tradeDetails} aria-label="外汇成交时戳证据"><h2>成交记录的时间</h2>{!venue?.rows.length?<p>等待通过校验的来源证据。</p>:venue.rows.map(row=><section key={row.pair}><h3>{row.pair}</h3>{row.trade_evidence?<dl>
   <dt>采集前固定窗口</dt><dd>{timestamp(row.trade_evidence.window_started_at)} 至 {timestamp(row.trade_evidence.window_ended_at)}</dd>
   <dt>窗口内最后返回成交</dt><dd>{row.trade_evidence.last_execution_at?timestamp(row.trade_evidence.last_execution_at):'窗口内未返回成交；没有可用成交时戳'}</dd>
   <dt>窗口内返回笔数</dt><dd>{row.trade_evidence.count} 笔 · {row.trade_evidence.coverage==='capped_response'?'达到返回上限，可能截断':'响应未触及上限，仍不保证完整覆盖'}</dd>
  </dl>:<p>当前窗口的成交证据尚未取得，共享冷却期间不沿用其他币种或其他窗口。下次页面允许检查：{timestamp(data?.status.next_retry_at??null)}。</p>}</section>)}</section>
  <section className={s.sources}><details><summary>来源、时效与使用边界</summary><ul><li>公开现货 API 不需要账户或密钥。只读取行情，无下单、账户访问或交易功能。保留个人访问边界，开源代码许可不代表数据再分发许可。</li><li>汇率是 USD / 基础币。24h 为滚动窗口；颜色为（最近价 ÷ 24h 成交均价 − 1）× 100，不是相对昨日收盘的涨跌。没有可比较资金金额，不制作金额面积或全球合计。</li><li>来源 Ticker 不提供报价观测时间。成交 API 的执行时间单独保留，获取时刻、窗口边界和游标不能冒充观测时间。每分钟检查不保证一分钟延迟。</li><li>超过 60 秒标陈旧，超过 15 分钟停止展示；网络失败不延长原快照年龄。共享拒绝和权限失效清空证据，不自动绕过。</li></ul></details><p><a href={KRAKEN_PAIRS_DOCS} target="_blank" rel="noreferrer">交易对目录 ↗</a><a href={KRAKEN_DOCS} target="_blank" rel="noreferrer">报价字段 ↗</a><a href={KRAKEN_TRADES_DOCS} target="_blank" rel="noreferrer">成交时戳字段 ↗</a><a href="https://support.kraken.com/articles/360000919986-public-endpoint-examples-you-can-try-them-directly-in-a-web-browser-" target="_blank" rel="noreferrer">公开接口说明 ↗</a></p></section>
 </main>;
}
