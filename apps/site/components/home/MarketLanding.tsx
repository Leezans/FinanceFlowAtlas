import React from 'react';
import {ArrowRight,Globe2,Grid2X2,Coins,ArrowLeftRight} from 'lucide-react';
import s from './home.module.css';

/** Discovery only: no embedded observations, synthetic heatmaps, or source checks. */
export default function MarketLanding() {
  return <section className={s.landing} aria-label="选择市场视图">
    <div className={s.intro}>
      <div><p className={s.eyebrow}>FINANCE FLOW ATLAS</p><h1>从板块，看见个股。</h1><p className={s.subtitle}>先选市场，再用图形探索。不同来源、时间和指标分别展示。</p></div>
      <a className={s.skip} href="#tic-view">继续看美国 TIC <ArrowRight size={14} aria-hidden="true"/></a>
    </div>
    <div className={s.grid}>
      <a className={`${s.card} ${s.featured}`} href="/ashare" aria-label="打开 A 股热力图：行业到个股">
        <Grid2X2 className={s.icon} size={30} aria-hidden="true"/>
        <div className={s.content}><span className={s.kicker}>行业 → 成分股</span><h2>A 股热力图</h2><p>点击行业区块，下钻查看股票。面积与颜色表达供应商主力净额。</p><small>订单分类估算，非市场真实新增资金</small></div>
        <ArrowRight className={s.arrow} size={22} aria-hidden="true"/>
      </a>
      <a className={s.card} href="/markets" aria-label="打开全球市场地图">
        <Globe2 className={s.icon} size={25} aria-hidden="true"/>
        <div className={s.content}><span className={s.kicker}>地图导航</span><h2>全球市场</h2><p>从国家或地区进入已有页面。</p><small>地理范围不等于数据覆盖</small></div>
        <ArrowRight className={s.arrow} size={18} aria-hidden="true"/>
      </a>
      <a className={s.card} href="/crypto" aria-label="打开加密现货：Kraken BTC 和 ETH">
        <Coins className={s.icon} size={25} aria-hidden="true"/>
        <div className={s.content}><span className={s.kicker}>BTC / ETH · USD</span><h2>加密现货</h2><p>Kraken 单一交易所价格与成交量。</p><small>成交量不是资金净流入</small></div>
        <ArrowRight className={s.arrow} size={18} aria-hidden="true"/>
      </a>
      <a className={s.card} href="/futures" aria-label="打开期货持仓：美国 CFTC 精选市场">
        <ArrowLeftRight className={s.icon} size={25} aria-hidden="true"/>
        <div className={s.content}><span className={s.kicker}>CFTC · 有发布滞后</span><h2>期货持仓</h2><p>黄金、原油、玉米与欧元期货的多空持仓。</p><small>合约张数与持仓变化，不是资金流</small></div>
        <ArrowRight className={s.arrow} size={18} aria-hidden="true"/>
      </a>
      <a className={s.card} href="/forex" aria-label="打开外汇参考：ECB 每日汇率">
        <ArrowLeftRight className={s.icon} size={25} aria-hidden="true"/>
        <div className={s.content}><span className={s.kicker}>ECB · 每日参考</span><h2>外汇参考</h2><p>欧洲央行参考汇率与交叉换算。</p><small>参考汇率不是资金流或实时交易报价</small></div>
        <ArrowRight className={s.arrow} size={18} aria-hidden="true"/>
      </a>
    </div>
    <p className={s.disclosure}>入口表示已有页面，不保证来源此刻可用。进入后查看观测期、获取时间与来源状态。</p>
  </section>;
}
