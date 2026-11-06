import React from 'react';
import s from './home.module.css';
/** Compact discovery chrome. The actual industry matrix follows immediately. */
export default function MarketLanding({onOpenTic}:{onOpenTic?:()=>void}={}){
 return <section className={s.landing} aria-label="选择市场视图">
  <div className={s.intro}><div><p className={s.eyebrow}>FINANCE FLOW ATLAS / INDUSTRY MATRIX</p><h1>从行业，看见资金流。</h1><p className={s.subtitle}>行业 → 成分股。直接看区块，点击下钻；来源缺失时保留画布。</p></div><span className={s.mode}>矩阵视图</span></div>
  <nav className={s.grid} aria-label="选择矩阵市场">
   <a className={s.featured} href="/ashare" aria-label="打开 A 股热力图：行业到个股">A 股行业 <span>行业 → 个股</span></a>
   <a href="/markets" aria-label="打开全球市场矩阵">全球市场</a>
   <a href="/crypto" aria-label="打开加密现货：Kraken BTC 和 ETH">加密现货</a>
   <a href="/options" aria-label="打开BTC / ETH 期权成交矩阵：Deribit单交易所">加密期权成交</a>
   <a href="/options/taiwan" aria-label="打开台湾期权日度金额矩阵：TAIFEX三类法人">台湾期权日报</a>
   <a href="/futures" aria-label="打开期货持仓：美国 CFTC 精选市场">期货持仓</a>
   <a href="/forex" aria-label="打开外汇行情：Kraken 法币现货与 ECB 每日参考">外汇行情</a>
   <a href="#tic-view" onClick={onOpenTic}>继续看美国 TIC</a>
  </nav>
  <p className={s.disclosure}>主力净额仅是东方财富大单与超大单的订单分类估算，不是所有交易资金净流入，也非市场真实新增资金。各来源独立展示，不混合单位、时点或口径。</p>
 </section>;
}
