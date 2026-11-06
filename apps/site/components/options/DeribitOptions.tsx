'use client';
import React from 'react';
import OptionsMatrix from './OptionsMatrix';
import {useOptionsEvidence} from './useOptionsEvidence';
import s from './options.module.css';
export default function DeribitOptions(){
 const {snapshot,loading,problem,blocked,refresh,stale}=useOptionsEvidence();
 return <main className={s.page}><header className={s.header}><div><p className={s.eyebrow}>DERIBIT / BTC + ETH OPTIONS</p><h1>BTC / ETH 期权成交矩阵</h1><p>单一交易所的公开市场快照，不代表全球期权市场。</p></div><button type="button" disabled={loading||blocked} onClick={()=>void refresh()}>{loading?'正在检查…':'检查更新'}</button></header>
 <div className={s.notice} role="status"><strong>{problem||(snapshot?(stale?'上次有效快照 · 已陈旧':'已核验来源快照'):'暂无可核验期权行情')}</strong><p>来源时间：{snapshot?snapshot.source_as_of:'未提供'} · 每分钟检查快照，不是连续流式行情；来源发布延迟不保证。</p><p>本次快照覆盖：{snapshot?snapshot.currencies.join(' / '):'未提供'}{snapshot?.currencies.length===1?' · 仅显示已核验标的，不代表 BTC 与 ETH 均已更新':''}。</p><p>最近成功获取：{snapshot?snapshot.fetched_at:'未提供'} · 仅获取成功不代表零延迟。</p></div>
 <OptionsMatrix snapshot={snapshot}/>
 <aside className={s.notice}><p>资金净流入：此来源不提供。面积仅表示来源原始 volume_usd（24小时成交额，USD），不是持仓价值。BTC 合约报价以 BTC / 标的 BTC 表示，ETH 合约报价以 ETH / 标的 ETH 表示；成交量、OI 与合约大小按各行标的分别以 BTC 或 ETH 表示。BTC / ETH 数量不跨币种相加，也不自行换算；面积仅使用来源已提供的 USD 金额。</p><p>OI 与部分成交量的发布延迟尚未确认。Deribit 的 2026-11-05 公告曾列出全量 OI 延迟 8 小时及 RFQ 成交量延迟，但该次发布已宣布推迟，不能据此认定延迟政策已生效，也不能保证实时。</p><p><a href="https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency" target="_blank" rel="noreferrer">官方行情字段说明</a> · <a href="https://support.deribit.com/hc/en-us/articles/40275495462301-5-November-2026" target="_blank" rel="noreferrer">官方发布延期公告</a></p></aside></main>;
}
