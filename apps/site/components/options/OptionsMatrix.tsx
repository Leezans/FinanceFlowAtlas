'use client';
import React,{useMemo,useState} from 'react';
import type {OptionsSnapshot} from '@/lib/options/model';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {changeText,expiryText,numberText,optionRows,optionsMatrixGroups} from './matrix';
import s from './options.module.css';
export default function OptionsMatrix({snapshot}:{snapshot:OptionsSnapshot|null}){
 const [query,setQuery]=useState(''),[expiry,setExpiry]=useState(''),[type,setType]=useState(''),[underlying,setUnderlying]=useState(''),[selected,setSelected]=useState('');
 const groups=useMemo(()=>optionsMatrixGroups(snapshot,query,expiry,type,underlying),[snapshot,query,expiry,type,underlying]);
 const row=optionRows(snapshot,query,expiry,type,underlying).find(item=>item.instrument===selected);
 const expiries=[...new Set(snapshot?.rows.map(item=>item.expiration_timestamp)??[])].sort((a,b)=>a-b);
 const coverage=snapshot?.currencies.join(' / ')??'BTC / ETH';
 return <section aria-label="期权矩阵工作区">
  <div className={s.controls}>
   <label>标的<select aria-label="期权标的" value={underlying} onChange={e=>setUnderlying(e.target.value)}><option value="">全部已覆盖标的</option><option value="BTC">BTC</option><option value="ETH">ETH</option></select></label>
   <label>查找合约<input aria-label="查找期权合约" value={query} onChange={e=>setQuery(e.target.value)} placeholder="BTC… / ETH…"/></label>
   <label>到期日<select aria-label="到期日" value={expiry} onChange={e=>setExpiry(e.target.value)}><option value="">全部到期日</option>{expiries.map(date=><option key={date} value={date}>{expiryText(date)} UTC</option>)}</select></label>
   <label>期权类型<select aria-label="期权类型" value={type} onChange={e=>setType(e.target.value)}><option value="">全部 Call / Put</option><option value="call">看涨 Call</option><option value="put">看跌 Put</option></select></label>
  </div>
  <MatrixHeatmap title={`${coverage} 期权成交矩阵`} groups={groups} description={`Deribit 单一交易所 · 当前快照覆盖 ${coverage} · 按标的与到期日分组；筛选仅作用于本地快照，点击合约查看详情。`} areaMeaning="来源24小时成交额（USD）；不是资金净流入，也不是 OI 金额" colorMeaning="来源24h价格变化（%）：红涨绿跌；无成交或未提供涨跌为未知，不视为零" colorMode="signed" selectedItemId={row?.instrument} onSelect={item=>setSelected(item.id)} scopeKey={`${underlying}/${expiry}/${type}/${query}`} emptyTitle="暂无可核验期权行情" emptyMessage="等待有效快照或调整筛选；不以示例数据填充。" emptyNote="零值与缺失不分配面积，可在数值明细中查找。"/>
  {row&&<section className={s.detail} aria-label="期权合约详情"><h2>{row.instrument}</h2><dl>{[
   ['标的',row.underlying_currency],['来源快照时间（UTC）',new Date(row.creation_timestamp).toISOString()],['到期时间（UTC）',new Date(row.expiration_timestamp).toISOString()],['类型',row.option_type==='call'?'看涨 Call':'看跌 Put'],['行权价',`${numberText(row.strike)} USD`],['来源24小时成交额（USD）',numberText(row.volume_usd)],['来源24小时成交量',`${numberText(row.volume)} ${row.underlying_currency}`],['来源未平仓量（OI）',`${numberText(row.open_interest)} ${row.underlying_currency} · 发布延迟未确认`],['标记价格',`${numberText(row.mark_price)} ${row.underlying_currency} / 标的 ${row.underlying_currency}`],['买价 / 卖价',`${numberText(row.bid_price)} / ${numberText(row.ask_price)} ${row.underlying_currency} / 标的 ${row.underlying_currency}`],['最近成交价',`${numberText(row.last)} ${row.underlying_currency} / 标的 ${row.underlying_currency}`],['标记隐含波动率',`${numberText(row.mark_iv)}%`],['来源24h价格变化',changeText(row.volume===0?null:row.price_change)],['合约大小',`${numberText(row.contract_size)} ${row.underlying_currency}`]
  ].map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><button type="button" onClick={()=>setSelected('')}>关闭详情</button></section>}
 </section>;
}
