'use client';
import React from 'react';
import {KRAKEN_DOCS,KRAKEN_PAIRS_DOCS} from '@/lib/crypto/kraken';
import s from './crypto.module.css';
import KrakenMatrix from './KrakenMatrix';
import KrakenRefreshNotice from './KrakenRefreshNotice';
import KrakenTradeMatrix from './KrakenTradeMatrix';
import KrakenPairSelector from './KrakenPairSelector';
import {visibleTradeSnapshot} from './trade-matrix';
import {useKrakenEvidence} from './useKrakenEvidence';
export {validateKrakenReply,visibleSnapshot} from './client';

function timestamp(value:string|null){return value?value.replace('T',' ').replace('Z',' UTC'):'未提供';}
export default function KrakenSpot(){
 const {data,loading,networkError,permissionLost,invalidResponse,now,selected,timeframe,catalogPairs,snapshot,age,stale,denied,refresh,applyScope}=useKrakenEvidence();
 return <main className={s.root}>
  <header className={s.header}><a href="/markets">◉ Finance Flow Atlas</a><nav aria-label="资产导航"><a href="/ashare">A 股优先入口</a><a href="/markets">全球市场</a></nav></header>
  <section className={s.intro}><p className={s.eyebrow}>CRYPTO / KRAKEN SPOT</p><h1>虚拟货币，先看清数据。</h1><p>Kraken · USD 报价现货交易对矩阵</p><p className={s.notice}>价格和成交量是交易活动，不是资金净流入。这里不是全球虚拟货币市场总量，也不接入账户或交易功能。</p></section>
  <section className={s.status} aria-live="polite" aria-label="行情获取状态"><div><strong>{permissionLost?'展示权限已失效':denied?'来源访问已停止':loading&&!snapshot?'正在获取公开行情':snapshot?stale?'上次有效快照 · 已陈旧':'已获取来源快照':'暂无可验证行情'}</strong><p>{permissionLost?'已清空浏览器行情并停止检查；请恢复登录或合法展示权限。':invalidResponse?'响应数据未通过校验，已清空浏览器行情。':denied?'来源拒绝访问后不会自动重试，也不更换访问路径。':networkError?'本次连接失败；只保留未超过 15 分钟的上次有效快照。':data?.status.error_code?'本次来源检查未成功；不填入零值或模拟数据。':'页面可见时约每 60 秒检查，交易对目录按需每 15 分钟复核。获取时间不等于成交时间或实时保证。'}</p>{data?.status.error_code&&<code>{data.status.error_code}</code>}</div><button onClick={()=>void refresh()} disabled={loading||denied||permissionLost}>{loading?'正在检查…':'检查更新'}</button></section>
  <KrakenRefreshNotice/>
  <div className={s.times}><span>最近成功获取 <b>{timestamp(snapshot?.fetched_at??data?.status.fetched_at??null)}</b></span><span>快照年龄 <b>{age===null?'无可展示快照':`${Math.floor(age/1000)} 秒`}</b></span><span>行情汇总成交时间 <b>接口未提供 · 延迟未知</b></span></div>
  {snapshot&&<p className={s.matrixNote}>目录获取时间：{timestamp(snapshot.catalog_fetched_at)} · 目录中 {snapshot.universe_pair_count} 组在线 USD 现货交易对，已核验 {snapshot.rows.length} 组。只代表此交易所与此报价币种，不代表全市场覆盖。</p>}
  <KrakenMatrix snapshot={snapshot}/>
  <KrakenPairSelector catalog={catalogPairs} selected={selected} disabled={!!denied||permissionLost} onApply={pairs=>applyScope(pairs,timeframe)}/>
  <fieldset className={s.windowControls} disabled={!!denied||permissionLost}><legend>成交统计区间</legend>{(['1m','5m'] as const).map(window=><label key={window}><input type="radio" name="trade-window" value={window} checked={timeframe===window} onChange={()=>applyScope(selected,window)}/>{window==='1m'?'1 分钟':'5 分钟'}</label>)}<p>仅切换所选交易对的固定成交区间；不改变 USD 报价目录。每 60 秒检查，共享来源冷却。</p></fieldset>
  {snapshot&&!data?.trade_snapshot&&<p className={s.matrixNote} role="status">所选交易对成交证据尚未取得；当前选择 {timeframe==='1m'?'1':'5'} 分钟；报价目录仍可使用。共享冷却不能绕过，下一次允许检查时间：{timestamp(data?.status.next_retry_at??null)}。缺失不代表零成交。</p>}
  <KrakenTradeMatrix selected={selected} timeframe={timeframe} snapshot={visibleTradeSnapshot(data?.trade_snapshot,!!snapshot,now)}/>
  <section className={s.sources}><details><summary>来源、指标与使用边界</summary><ul><li>价格以 USD 报价，成交量以各自基础币种的数量计量。不能把不同币种的数量直接相加。</li><li>24 小时字段使用来源的滚动窗口，不使用“今天 UTC 零点以来”字段。不推算跨境流向、交易所充值提现或买卖资金净额。</li><li>快照获取成功仅说明接口返回通过校验；接口没有提供这组行情的观测时间。超过 60 秒标记陈旧，超过 15 分钟停止展示。</li><li>公开接口不需要 Kraken 账户或 API 密钥。代码开源不等于行情数据获得再分发许可；本页保留现有个人访问边界。</li></ul></details><p><a href={KRAKEN_PAIRS_DOCS} target="_blank" rel="noreferrer">Kraken 官方交易对目录 ↗</a><a href={KRAKEN_DOCS} target="_blank" rel="noreferrer">Kraken 官方字段说明 ↗</a><a href="https://support.kraken.com/articles/360000919986-public-endpoint-examples-you-can-try-them-directly-in-a-web-browser-" target="_blank" rel="noreferrer">公开接口与账户要求 ↗</a><a href="https://docs-legacy.kraken.com/api/docs/guides/global-intro/" target="_blank" rel="noreferrer">API 使用条件 ↗</a></p></section>
 </main>;
}
