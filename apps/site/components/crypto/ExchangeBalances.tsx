'use client';
import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {BalanceComparison,compareExchangeBalances,EXCHANGE_ENDPOINT,EXCHANGE_TERMS} from '@/lib/crypto/exchange-balances';
import s from './crypto.module.css';
const time=(seconds:number)=>new Date(seconds*1000).toISOString().replace('T',' ').replace('.000Z',' UTC');
const subscribeToLocation=()=>()=>{};
const loopback=()=>['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);
const number=(value:number|null)=>value===null?'不可计算':value.toLocaleString('zh-CN',{maximumSignificantDigits:10});
// 手动单次浏览器请求，不建代理、缓存、轮询、导出或公开数据集。
export default function ExchangeBalances(){
 const [data,setData]=useState<BalanceComparison|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[accepted,setAccepted]=useState(false),[checked,setChecked]=useState<number|null>(null),[attempted,setAttempted]=useState(false);
 const local=useSyncExternalStore(subscribeToLocation,loopback,()=>false);
 const active=useRef<AbortController|null>(null);
 // 公开预览的开发服务器也不能启用；浏览器入口必须使用回环地址。
 useEffect(()=>()=>active.current?.abort(),[]);
 async function load(){
  if(!local||!['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)||active.current||attempted||!accepted)return;
  const controller=new AbortController();active.current=controller;setLoading(true);setAttempted(true);setData(null);setError('');
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
   const response=await fetch(EXCHANGE_ENDPOINT,{signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
   if(!response.ok)throw new Error(`来源返回 HTTP ${response.status}；本页不会重试或切换通道。`);
   const result=compareExchangeBalances(await response.json());setData(result);setChecked(Date.now());
  }catch(e){setError(e instanceof Error?e.message:'来源不可用；不展示模拟数据。');}
  finally{clearTimeout(timer);active.current=null;setLoading(false);}
 }
 if(!local)return <main><h1>仅限本地回环地址</h1><p>请通过 localhost、127.0.0.1 或 [::1] 访问个人研究页面。公开预览不会请求来源。</p></main>;
 return <main className={s.root}>
  <header className={s.header}><a href="/crypto">返回虚拟货币</a><span>LOCAL PERSONAL RESEARCH</span></header>
  <section className={s.intro}><h1>Binance 已跟踪钱包余额变化</h1><p className={s.notice}>估算的已跟踪钱包净资产数量变化，不是市场投资资金流、买入额、充值总额或逐笔验证的充提净额。仅覆盖 DefiLlama 跟踪范围，不代表 Binance 全部资产、负债或偿付能力。</p></section>
  <section className={s.status}><div><p>仅限个人、非商业本地研究。数据直接从官方公开 API 进入本浏览器内存，不经过本站服务器。来源可能有钱包识别、币种覆盖或估值修订。</p><p><a href={EXCHANGE_TERMS} target="_blank" rel="noreferrer">阅读来源使用条款</a> · <a href="https://api-docs.defillama.com/llms-free.txt" target="_blank" rel="noreferrer">官方免费接口说明</a></p><label><input type="checkbox" checked={accepted} disabled={attempted} onChange={e=>setAccepted(e.target.checked)}/> 我已阅读条款，仅作个人非商业研究，不再分发来源数据。</label></div><button disabled={!accepted||attempted||loading} onClick={()=>void load()}>{loading?'正在获取…':'获取一次来源快照'}</button></section>
  {error&&<p role="alert">{error}</p>}
  {data&&<><section className={s.times}><p>获取时间：{checked?new Date(checked).toISOString():'未知'}</p><p>来源最新数量快照：{time(data.latest)}。截至获取时距此快照约 {checked?Math.floor((checked/1000-data.latest)/3600):'未知'} 小时。来源实际发布延迟未知，不保证小时更新。</p><p>比较区间：{time(data.start)} → {time(data.end)}。仅相邻 UTC 零点快照；当天零点及盘中尾点不参与，保守延后展示。已排除 {data.excluded} 个较新快照。</p><p>返回的当前链范围：{data.chains.join('、')||'未提供'}；不证明历史钱包范围一致。</p></section>
  <p className={s.notice}>历史区间，非实时资金流。{data.coverageChanged?'币种覆盖发生变化，缺失端点不计算变化。':'两端币种标签一致仍不能证明钱包覆盖一致。'} 不汇总不同币种数量或计算交易所总流入。</p>
  <div style={{overflowX:'auto'}}><table><caption>来源币种标签与原生数量（同名标签不证明同一合约）</caption><thead><tr>{['币种标签','期初数量','期末数量','数量净变化','期末隐含 USD 单价','数量变化 × 期末单价 (USD)'].map(t=><th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{data.rows.map(r=><tr key={r.asset}><th scope="row">{r.asset}</th><td>{number(r.before)}</td><td>{number(r.after)}</td><td>{number(r.change)}</td><td>{number(r.priceUsd)}</td><td>{number(r.changeAtEndPriceUsd)}</td></tr>)}</tbody></table></div>
  <p>隐含单价 = 同一时间、同一标签的来源 USD 估值 / 原生数量。零余额、缺失估值不推导价格。USD 列只按期末价格折算数量差，不等于美元余额变化，也不代表实际成交或转账金额。</p></>}
 </main>;
}
