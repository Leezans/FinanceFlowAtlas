'use client';
import React,{useEffect,useState} from 'react';
import type {EvidenceState} from './client';
import {ASHARE_CALENDAR,acquisitionAgeLabel,formatShanghaiTimestamp,getAcquisitionTiming,getAshareSession} from './timing';
import './timing.css';

/** Local clock updates do not fetch data or invent provider timestamps. */
export default function MarketTiming({state,loading=false}:{state:EvidenceState;loading?:boolean}) {
 const [now,setNow] = useState<number | null>(null);
 const snapshot = state.status === 'ready' || state.status === 'stale' ? state.snapshot : null;
 useEffect(()=>{
  const update = ()=>setNow(Date.now());
  // A newly fetched snapshot can postdate the previous 15-second clock sample.
  // Resample on replacement; do not clamp a genuinely future timestamp to now.
  const start = setTimeout(update,0);
  const timer = setInterval(update,15_000);
  // A suspended/background tab must not keep displaying an old session clock.
  const visible = ()=>{if(document.visibilityState === 'visible')update();};
  window.addEventListener('focus',update);
  document.addEventListener('visibilitychange',visible);
  return ()=>{clearTimeout(start);clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',visible);};
 },[snapshot?.fetched_at]);
 const session = getAshareSession(now);
 const acquisition = getAcquisitionTiming(snapshot&&state.retainedAfterFailure?{...snapshot,stale:true,has_error:true}:snapshot,now);
 const age = acquisitionAgeLabel(acquisition.ageMs);
 const collectionStart=snapshot?.collection_started_at?formatShanghaiTimestamp(snapshot.collection_started_at):null;
 const fetched = snapshot ? formatShanghaiTimestamp(snapshot.fetched_at) : null;
 return <section className="ashare-timing" aria-label="市场时段与数据时间">
  <div className="timing-session">
   <span>沪深 A 股 · 普通竞价时段</span>
   <strong>{session.label}</strong>
   <span>{session.localDate ? `${session.localDate} ${session.localTime} · 北京/上海时间（UTC+8）` : '按设备时间计算'}</span>
   <small>按交易所日历推算，不是行情连接状态；不含临时停市与个股停牌。</small>
  </div>
  <dl>
   <div><dt>来源交易日期</dt><dd>未提供</dd><small>不能确认属于哪个交易日</small></div>
   <div><dt>来源行情时点 / 延迟</dt><dd>均未知</dd><small>采集成功不等于实时行情</small></div>
   <div><dt>最近完整采集 · 北京时间</dt><dd>{fetched ? <time dateTime={snapshot!.fetched_at}>{fetched}</time> : '尚未取得'}</dd><small>{age ? `${age}（按设备时间）` : '采集时间不是行情时间'}</small></div>
  </dl>
  {collectionStart&&<p>本次完整采集窗口 · 北京时间：{collectionStart} 至 {fetched}。分页不是同一时刻的原子快照；各页仍可能存在时差。</p>}
  <p className="timing-acquisition" data-acquisition-status={acquisition.status} role="status">{state.retainedDuringCollection?'完整分页仍在核对，保留上次完整快照':acquisition.label}{loading ? '；正在获取并核对完整分页' : ''}。</p>
  <details><summary>时间口径与日历依据</summary>
   <p>休市不代表数据过期，处于交易时段也不代表数据实时。当前采集尚未验证主力净额对应的交易日期、资金观测时间或来源延迟，以上三项不会用抓取日期补齐。</p>
   <p>报价更新时间不等于资金观测时间。只有确认时间字段与主力净额属于同一观测记录后，才能据此判断资金数据的新旧。</p>
   <p>60 秒是页面打开期间的目标检查间隔，不是后台采集承诺；关闭页面后不会继续更新。浏览器休眠或后台节流可能延迟检查，返回可见页面时补查已到期请求，仍遵守冷却与停止状态。缓存年龄依据设备时钟估算。采集超过间隔或服务器报告刷新失败时会单独提示，不把旧缓存标成最新行情。</p>
   <p>当前只核对了 <a href={ASHARE_CALENDAR.holidaySource} target="_blank" rel="noreferrer">2026 年上交所休市安排</a>。周末调休上班不改成交易日；日历年份以外显示未知。<a href={ASHARE_CALENDAR.hoursSource} target="_blank" rel="noreferrer">股票竞价交易时段</a>：09:15–09:25 开盘集合竞价；09:30–11:30、13:00–14:57 连续竞价；14:57–15:00 收盘集合竞价。仅用于沪深 A 股普通竞价时段参考，不覆盖盘后交易。</p>
  </details>
 </section>;
}
