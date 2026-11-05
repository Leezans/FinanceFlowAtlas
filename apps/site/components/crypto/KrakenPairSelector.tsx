'use client';
import React,{useState} from 'react';
import {DEFAULT_TRADE_PAIRS as TRADE_PAIRS,MAX_SELECTED_TRADE_PAIRS,canonicalTradeSelection,tradeSelectionKey} from '@/lib/crypto/selection';
import s from './crypto.module.css';

type Props={catalog:readonly string[];selected:readonly string[];disabled:boolean;onApply:(pairs:string[])=>void};
// Empty drafts are allowed while editing, but can never be applied.
const selectionKey=(pairs:readonly string[])=>pairs.length?tradeSelectionKey(pairs):'';
export default function KrakenPairSelector({catalog,selected,disabled,onApply}:Props){
 const [draft,setDraft]=useState<string[]>([...selected]),[search,setSearch]=useState('');
 const changed=selectionKey(draft)!==selectionKey(selected);
 const options=[...new Set(catalog.length?[...catalog,...draft]:[])].sort().filter(pair=>pair.includes(search.trim().toUpperCase()));
 return <section className={s.selector} aria-label="逐笔成交交易对选择">
  <h2>选择逐笔成交交易对</h2>
  <p>每次最多检查 3 组；上方全目录报价矩阵独立展示。切换选择不能绕过来源冷却或拒绝访问；仍按 60 秒节奏检查，不额外轮询来源。</p>
  <p aria-live="polite">已应用：{selected.join('、')}。待应用 {draft.length} / 3：{draft.join('、')||'未选择'}</p>
  <label>搜索已核验 USD 交易对 <input type="search" value={search} onChange={event=>setSearch(event.target.value)} disabled={disabled||!catalog.length}/></label>
  {!catalog.length&&<p>等待有效交易对目录；暂无可用目录选项。</p>}
  <div className={s.pairOptions}>{options.map(pair=><label key={pair}><input type="checkbox" checked={draft.includes(pair)} disabled={disabled||!catalog.length||!draft.includes(pair)&&draft.length>=MAX_SELECTED_TRADE_PAIRS} onChange={event=>setDraft(previous=>event.target.checked?[...previous,pair]:previous.filter(item=>item!==pair))}/>{pair}{!catalog.includes(pair)&&'（当前目录未提供）'}</label>)}</div>
  <div className={s.selectorActions}><button disabled={disabled||!catalog.length||!draft.length} onClick={()=>setDraft([])}>清空待选</button><button disabled={disabled||!catalog.length||!draft.length||!changed} onClick={()=>onApply(canonicalTradeSelection(draft))}>应用选择</button><button disabled={disabled||!catalog.length||selectionKey(draft)===selectionKey(TRADE_PAIRS)} onClick={()=>setDraft([...TRADE_PAIRS])}>恢复默认选择</button></div>
 </section>;
}
