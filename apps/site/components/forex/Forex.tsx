'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {absoluteRetryDeadline,retryAfterDeadline,timerDelay,untilAborted} from '@/lib/browser-request';
import {CACHE_TTL_MS,CHECK_INTERVAL_MS,ECB_INFO,ECB_RIGHTS,ECB_URL,crossRate,fxPayloadSchema,referenceAgeDays,type FxPayload} from '@/lib/fx/model';
import s from './forex.module.css';
import FxReferenceMatrix from './FxReferenceMatrix';
import {currencyNames as names} from './matrix';

const errors:Record<string,string>={cache_expired:'已验证参考数据超过七天保留期，已停止展示；等待下一次允许的来源检查。',network_error:'来源连接失败。',source_unavailable:'ECB 来源暂时不可用。',invalid_source:'来源内容未通过完整性校验。',source_older:'来源返回了比已有记录更早的日期，未覆盖已有记录。',source_stopped:'来源拒绝、限流、重定向或返回非 XML 页面，共享检查已停止，重启不会解除限制。',source_busy:'共享来源检查正在进行或等待人工核验。',source_cooldown:'共享来源检查仍在冷却期。',source_gate_unavailable:'无法确认共享检查状态，已清空数据并安全停止。'};
function time(value:string|null){return value?new Date(value).toISOString().replace('T',' ').replace(/\.\d+Z$/,' UTC'):'尚未检查'}
function number(value:number){return new Intl.NumberFormat('zh-CN',{maximumSignificantDigits:8}).format(value)}

export default function Forex(){
 const [payload,setPayload]=useState<FxPayload|null>(null),[loading,setLoading]=useState(true),[browserError,setBrowserError]=useState(''),[blocked,setBlocked]=useState(false),[retryDeadline,setRetryDeadline]=useState(0);
 const [from,setFrom]=useState('USD'),[to,setTo]=useState('CNY'),[amount,setAmount]=useState('1'),[query,setQuery]=useState(''),[clock,setClock]=useState(()=>Date.now());
 const busy=useRef(false),alive=useRef(false),stop=useRef(false),abort=useRef<AbortController|null>(null);
 const retryAt=useRef(0),poll=useRef<ReturnType<typeof setTimeout>|null>(null),reload=useRef<()=>Promise<void>>(async()=>{});
 const load=useCallback(async()=>{
  if(busy.current||stop.current||!alive.current)return;
  if(poll.current)clearTimeout(poll.current);poll.current=null;
  if(Date.now()<retryAt.current){poll.current=setTimeout(()=>void reload.current(),timerDelay(retryAt.current));return;}
  busy.current=true;setLoading(true);const controller=new AbortController();abort.current=controller;
  const timeout=setTimeout(()=>controller.abort(),20_000);
  try{
   const response=await untilAborted(fetch('/api/v1/fx/reference',{cache:'no-store',signal:controller.signal}),controller.signal);
   if(!alive.current||controller!==abort.current)return;
   retryAt.current=Math.max(retryAt.current,retryAfterDeadline(response.headers.get('Retry-After')));
   if(response.status===401||response.status===403){setPayload(null);setBrowserError('展示权限不可用，已清空数据并停止检查。');stop.current=true;setBlocked(true);return}
   const parsed=fxPayloadSchema.safeParse(await untilAborted(response.json(),controller.signal).catch(()=>null));
   if(!alive.current||controller!==abort.current)return;
   if(!parsed.success){
    if(response.ok){setPayload(null);setBrowserError('响应校验失败，已清空数据。')}
    else setBrowserError('页面连接暂时失败；如有旧值，仅保留本页已校验的参考数据。');
    return;
   }
   if(!response.ok&&response.status!==503){setBrowserError('页面连接暂时失败；如有旧值，仅保留本页已校验的参考数据。');return}
   retryAt.current=Math.max(retryAt.current,absoluteRetryDeadline(parsed.data.next_check_at));
   setPayload(parsed.data);setBrowserError('');
   if(parsed.data.source_state==='stopped'){stop.current=true;setBlocked(true)}
   setClock(Date.now());
  }catch{if(alive.current&&controller===abort.current)setBrowserError('页面连接暂时失败；如有旧值，仅保留本页已校验的参考数据。')}
  finally{clearTimeout(timeout);if(controller===abort.current){busy.current=false;if(alive.current){setLoading(false);setRetryDeadline(retryAt.current);setClock(Date.now());if(!stop.current)poll.current=setTimeout(()=>void reload.current(),timerDelay(Math.max(retryAt.current,Date.now()+CHECK_INTERVAL_MS)))}}}
 },[]);
 useEffect(()=>{
  alive.current=true;reload.current=load;const start=setTimeout(()=>void load(),0),clockTimer=setInterval(()=>setClock(Date.now()),60_000);
  return()=>{alive.current=false;clearTimeout(start);if(poll.current)clearTimeout(poll.current);poll.current=null;clearInterval(clockTimer);abort.current?.abort();abort.current=null;busy.current=false};
 },[load]);
 useEffect(()=>{
  const refreshClock=()=>setClock(Date.now());
  const expires=payload?.snapshot?Date.parse(payload.snapshot.retrieved_at)+CACHE_TTL_MS:null;
  const expiryTimer=expires!==null&&expires>Date.now()?setTimeout(refreshClock,expires-Date.now()+1):null;
  window.addEventListener('focus',refreshClock);window.addEventListener('pageshow',refreshClock);document.addEventListener('visibilitychange',refreshClock);
  return()=>{if(expiryTimer!==null)clearTimeout(expiryTimer);window.removeEventListener('focus',refreshClock);window.removeEventListener('pageshow',refreshClock);document.removeEventListener('visibilitychange',refreshClock)};
 },[payload]);
 const cacheExpired=!!payload?.snapshot&&clock>=Date.parse(payload.snapshot.retrieved_at)+CACHE_TTL_MS;
 const snapshot=cacheExpired?null:payload?.snapshot??null;
 const currencies=snapshot?['EUR',...snapshot.rates.map(r=>r.currency)]:[];
 const selectedFrom=currencies.includes(from)?from:'EUR',selectedTo=currencies.includes(to)?to:currencies.find(c=>c!=='EUR')??'EUR';
 const rate=snapshot?crossRate(snapshot,selectedFrom,selectedTo):null;
 const numericAmount=amount.trim()===''?NaN:Number(amount),converted=rate!==null?numericAmount*rate:NaN;
 const validAmount=Number.isFinite(numericAmount)&&numericAmount>=0&&numericAmount<=1e12&&Number.isFinite(converted);
 const age=snapshot?referenceAgeDays(snapshot.reference_date,clock):null;
 const overdue=!!payload?.checked_at&&clock-Date.parse(payload.checked_at)>CHECK_INTERVAL_MS;
 const stale=!!snapshot&&(!!browserError||payload?.source_state==='stale'||overdue);
 const next=Math.max(retryDeadline,absoluteRetryDeadline(payload?.next_check_at));
 const waiting=!!next&&clock<next;
 const nextDate=new Date(next);
 const nextLabel=Number.isFinite(nextDate.getTime())?time(nextDate.toISOString()):'等待服务器允许后再检查';
 return <main className={s.root}>
  <header className={s.header}><a href="/markets" className={s.brand}>◉ Finance Flow Atlas</a><nav aria-label="资产导航"><a href="/markets">全球市场</a><a href="/ashare">A 股</a><span>外汇参考</span></nav></header>
  <section className={s.hero}><div><p className={s.eyebrow}>FOREIGN EXCHANGE / ECB</p><h1>看清汇率，分清口径。</h1><p>欧洲央行每日参考汇率。独立外汇资料层，<strong>不是资金流、实时行情或可成交报价。</strong></p></div><span className={s.badge}>免费官方来源 · 无需账户</span></section>
  <div className={s.notice}>ECB 通常于工作日约 16:00 CET 更新（TARGET 休市日除外），并明确不鼓励用于交易。页面检查不代表来源更新；这里不推断分钟级行情或市场涨跌。</div>
  <section className={s.facts} aria-label="数据日期与覆盖"><div><span>来源参考日期</span><strong>{snapshot?.reference_date??'暂无数据'}</strong><small>{age!==null?`距参考日期 ${age} 个日历日；不是延迟测量`:'不以抓取时间代替参考日期'}</small></div><div><span>本次实际覆盖</span><strong>{snapshot?`${snapshot.rates.length} 种报价币`:'尚未核验'}</strong><small>另含 EUR 基准；非所有国家或货币</small></div><div><span>来源检查状态</span><strong>{loading?'正在检查…':blocked?'检查已停止':!snapshot?'尚无可用值':stale?'保留旧参考值':'最近检查成功'}</strong><small>最近检查：{time(payload?.checked_at??null)}</small></div></section>
  <section className={s.status} aria-live="polite"><div>
   {browserError&&<p role="alert">{browserError}</p>}
   {cacheExpired&&<p role="alert">{errors.cache_expired}</p>}
   {payload?.error_code&&<p role="alert">{errors[payload.error_code]}{snapshot?' 当前保留上次校验通过的参考值。':' 不展示替代或模拟数据。'}</p>}
   {age!==null&&age>7&&<p role="alert">参考日期已超过 7 个日历日，请谨慎使用。这是保守提醒，不是已核验的节假日发布日历。</p>}
   {overdue&&<p>最近来源检查距今超过 1 小时，请查看日期后使用。</p>}
   <p>共享来源检查成功后至少间隔 1 小时；临时失败后至少等待 15 分钟。{next&&!blocked?`下次页面检查时间（来源仍可能冷却）：${nextLabel}`:''}</p>
  </div><button disabled={loading||blocked||waiting} onClick={()=>void load()}>{loading?'检查中…':blocked?'来源检查已停止':waiting?'等待下次检查':'检查 ECB 来源'}</button></section>
  <FxReferenceMatrix snapshot={snapshot} query={query} onQueryChange={setQuery} loading={loading}/>
  {snapshot&&<details className={s.conversionPanel}><summary>交叉汇率换算 · 同一参考日的计算工具</summary><div className={s.workspace}>
   <section className={s.converter} aria-labelledby="converter-title"><p className={s.eyebrow}>REFERENCE CONVERSION</p><h2 id="converter-title">交叉汇率换算</h2><p>以同一参考日的 EUR 报价相除计算，仅供研究。</p>
    <label htmlFor="fx-amount">换算数量</label><input id="fx-amount" inputMode="decimal" type="number" min="0" max="1000000000000" step="any" value={amount} onChange={e=>setAmount(e.target.value)}/>
    <div className={s.pair}><div><label htmlFor="fx-from">从</label><select id="fx-from" value={selectedFrom} onChange={e=>setFrom(e.target.value)}>{currencies.map(c=><option key={c} value={c}>{c} · {names[c]??c}</option>)}</select></div><button aria-label="交换换算货币" onClick={()=>{setFrom(selectedTo);setTo(selectedFrom)}}>⇄</button><div><label htmlFor="fx-to">换算为</label><select id="fx-to" value={selectedTo} onChange={e=>setTo(e.target.value)}>{currencies.map(c=><option key={c} value={c}>{c} · {names[c]??c}</option>)}</select></div></div>
    <div className={s.result} aria-live="polite"><span>参考换算结果 · {snapshot.reference_date}</span><strong>{validAmount?`${number(converted)} ${selectedTo}`:'请输入 0 至 1 万亿的有效数量'}</strong><small>{rate!==null?`1 ${selectedFrom} ≈ ${number(rate)} ${selectedTo}`:'该币种未覆盖'}</small></div>
    <p className={s.formula}>计算：目标币 / EUR ÷ 起始币 / EUR × 数量。结果经过显示舍入，不含买卖价差、费用或可交易性保证；不用于合并其他日期的资产或资金流。</p>
   </section>
  </div></details>}
  <footer className={s.footer}><p>来源：European Central Bank（欧洲央行）。<a href={ECB_INFO} target="_blank" rel="noreferrer">官方说明 ↗</a> · <a href={ECB_URL} target="_blank" rel="noreferrer">免费原始 XML ↗</a> · <a href={ECB_RIGHTS} target="_blank" rel="noreferrer">使用条件与免责声明 ↗</a></p><p>获取时间：{time(snapshot?.retrieved_at??null)}。这是本服务完整获取并校验的时间，不是发布时刻；XML 仅提供参考日期。</p><details><summary>来源、换算与使用边界</summary><p>个人研究视图，保留现有站点访问控制。仅展示当次来源列出的货币；EUR = 1 是基准恒等关系，不额外计入报价覆盖。未提供的货币不补零，也不接入其他来源拼接。</p><p>ECB 允许按其条件免费使用网站信息，要求准确呈现并注明来源，修改或换算须明确标注；付费分发还有免费来源告知要求。此处交叉汇率是本应用的计算结果，矩阵保持来源数字精度。软件开源许可不替代 ECB 数据条款，也不代表 ECB 背书。未改变访问权限或对外发布范围。</p><p>已验证的公开 ECB 参考汇率与共享检查状态保存在 D1，供不同服务进程一致读取；不保存账户或凭证。获取超过七天的值停止展示，失败检查不会延长保留期。拒绝状态跨进程重启保留；缓存到期不解除限制，未完成或不确定的检查不会自动接管，须人工核验。未核验独立部署环境中的来源可达性。</p></details></footer>
 </main>;
}
