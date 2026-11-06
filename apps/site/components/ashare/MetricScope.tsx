import React from 'react';
import {ASHARE_FLOW_METHODOLOGY_URL} from '@/lib/ashare/metric-semantics';

/** Keep the meaning available even when observations are absent or stopped. */
export default function MetricScope(){
 return <aside className="ashare-metric-scope" role="note" aria-label="主力净额计算口径">
  <strong>主力净额 · 东方财富订单分类估算</strong>
  <p>本页展示来源字段 f62，单位为人民币。按东方财富公开说明，主力净额 = 超大单净额 + 大单净额；各类净额为流入减流出，不包含中单、小单。</p>
  <p>正负值只表示该分类口径的净流入或净流出，<strong>不是个股或全市场所有交易资金的净流入</strong>，也不等于新增入市资金；不能据此识别具体机构。</p>
  <a href={ASHARE_FLOW_METHODOLOGY_URL} target="_blank" rel="noreferrer">东方财富资金流说明</a>
 </aside>;
}
