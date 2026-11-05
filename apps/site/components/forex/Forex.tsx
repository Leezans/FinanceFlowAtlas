'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {CHECK_INTERVAL_MS,ECB_INFO,ECB_RIGHTS,ECB_URL,crossRate,fxPayloadSchema,referenceAgeDays,type FxPayload} from '@/lib/fx/model';
import s from './forex.module.css';

const names:Record<string,string>={EUR:'欧元',USD:'美元',CNY:'人民币',JPY:'日元',GBP:'英镑',HKD:'港元',CHF:'瑞士法郎',AUD:'澳元',CAD:'加拿大元',SGD:'新加坡元',KRW:'韩元',INR:'印度卢比',NZD:'新西兰元',BRL:'巴西雷亚尔',MXN:'墨西哥比索',ZAR:'南非兰特',SEK:'瑞典克朗',NOK:'挪威克朗',DKK:'丹麦克朗',CZK:'捷克克朗',PLN:'波兰兹罗提',HUF:'匈牙利福林',RON:'罗马尼亚列伊',ISK:'冰岛克朗',TRY:'土耳其里拉',IDR:'印尼卢比',ILS:'以色列新谢克尔',MYR:'马来西亚林吉特',PHP:'菲律宾比索',THB:'泰铢'};
const errors:Record<string,string>={network_error:'来源连接失败。',source_unavailable:'ECB 来源暂时不可用。',invalid_source:'来源内容未通过完整性校验。',source_older:'来源返回了比已有记录更早的日期，未覆盖已有记录。',source_stopped:'来源拒绝、限流、重定向或返回非 XML 页面，已停止本次服务进程的检查。'};
function time(value:string|null){return value?new Date(value).toISOString().replace('T',' ').replace(/\.\d+Z$/,' UTC'):'尚未检查'}
function number(value:number){return new Intl.NumberFormat('zh-CN',{maximumSignificantDigits:8}).format(value)}

export default function Forex(){
 const [payload,setPayload]=useState<FxPayload|null>(null),[loading,setLoading]=useState(true),[browserError,setBrowserError]=useState(''),[blocked,setBlocked]=useState(false);
 const [from,setFrom]=useState('USD'),[to,setTo]=useState('CNY'),[amount,setAmount]=useState('1'),[query,setQuery]=useState(''),[clock,setClock]=useState(()=>Date.now());
 const busy=useRef(false),alive=useRef(false),stop=useRef(false),abort=useRef<AbortController|null>(null);
 const load=useCallback(async()=>{
  if(busy.current||stop.current||!alive.current)return;
  busy.current=true;setLoading(true);const controller=new AbortController();abort.current=controller;
  const timeout=setTimeout(()=>controller.abort(),20_000);
  try{
   const response=await fetch('/api/v1/fx/reference',{cache:'no-store',signal:controller.signal});
   if(!alive.current||controller!==abort.current)return;
   if(response.status===401||response.status===403){setPayload(null);setBrowserError('展示权限不可用，已清空数据并停止检查。');stop.current=true;setBlocked(true);return}
   const parsed=fxPayloadSchema.safeParse(await response.json().catch(()=>null));
   if(!alive.current||controller!==abort.current)return;
   if(!parsed.success){
    if(response.ok){setPayload(null);setBrowserError('响应校验失败，已清空数据。')}
    else setBrowserError('页面连接暂时失败；如有旧值，仅保留本页已校验的参考数据。');
    return;
   }
   if(!response.ok&&response.status!==503){setBrowserError('页面连接暂时失败；如有旧值，仅保留本页已校验的参考数据。');return}
   setPayload(parsed.data);setBrowserError('');
   if(parsed.data.source_state==='stopped'){stop.current=true;setBlocked(true)}
   setClock(Date.now());
  }catch{if(alive.current&&controller===abort.current)setBrowserError('页面连接暂时失败；如有旧值，仅保留本页已校验的参考数据。')}
  finally{clearTimeout(timeout);if(controller===abort.current){busy.current=false;if(alive.current)setLoading(false)}}
 },[]);
 useEffect(()=>{
  alive.current=true;const start=setTimeout(()=>void load(),0),timer=setInterval(()=>void load(),CHECK_INTERVAL_MS),clockTimer=setInterval(()=>setClock(Date.now()),60_000);
  return()=>{alive.current=false;clearTimeout(start);clearInterval(timer);clearInterval(clockTimer);abort.current?.abort();abort.current=null;busy.current=false};
 },[load]);
 const snapshot=payload?.snapshot??null;
 const currencies=snapshot?['EUR',...snapshot.rates.map(r=>r.currency)]:[];
 const selectedFrom=currencies.includes(from)?from:'EUR',selectedTo=currencies.includes(to)?to:currencies.find(c=>c!=='EUR')??'EUR';
 const rate=snapshot?crossRate(snapshot,selectedFrom,selectedTo):null;
 const numericAmount=amount.trim()===''?NaN:Number(amount),converted=rate!==null?numericAmount*rate:NaN;
 const validAmount=Number.isFinite(numericAmount)&&numericAmount>=0&&numericAmount<=1e12&&Number.isFinite(converted);
 const age=snapshot?referenceAgeDays(snapshot.reference_date,clock):null;
 const overdue=!!payload?.checked_at&&clock-Date.parse(payload.checked_at)>CHECK_INTERVAL_MS;
 const queryLower=query.trim().toLowerCase(),rows=snapshot?.rates.filter(r=>`${r.currency} ${names[r.currency]??''}`.toLowerCase().includes(queryLower))??[];
 const stale=!!snapshot&&(!!browserError||payload?.source_state==='stale'||overdue);
 const next=payload?.next_check_at?Date.parse(payload.next_check_at):0;
 const waiting=!!next&&clock<next;
 return <main className={s.root}>
  <header className={s.header}><a href="/markets" className={s.brand}>◉ Finance Flow Atlas</a><nav aria-label="资产导航"><a href="/markets">全球市场</a><a href="/ashare">A 股</a><span>外汇参考</span></nav></header>
  <section className={s.hero}><div><p className={s.eyebrow}>FOREIGN EXCHANGE / ECB</p><h1>看清汇率，分清口径。</h1><p>欧洲央行每日参考汇率。独立外汇资料层，<strong>不是资金流、实时行情或可成交报价。</strong></p></div><span className={s.badge}>免费官方来源 · 无需账户</span></section>
  <div className={s.notice}>ECB 通常于工作日约 16:00 CET 更新（TARGET 休市日除外），并明确不鼓励用于交易。页面检查不代表来源更新；这里不推断分钟级行情或市场涨跌。</div>
  <section className={s.facts} aria-label="数据日期与覆盖"><div><span>来源参考日期</span><strong>{snapshot?.reference_date??'暂无数据'}</strong><small>{age!==null?`距参考日期 ${age} 个日历日；不是延迟测量`:'不以抓取时间代替参考日期'}</small></div><div><span>本次实际覆盖</span><strong>{snapshot?`${snapshot.rates.length} 种报价币`:'尚未核验'}</strong><small>另含 EUR 基准；非所有国家或货币</small></div><div><span>来源检查状态</span><strong>{loading?'正在检查…':blocked?'检查已停止':!snapshot?'尚无可用值':stale?'保留旧参考值':'最近检查成功'}</strong><small>最近检查：{time(payload?.checked_at??null)}</small></div></section>
  <section className={s.status} aria-live="polite"><div>
   {browserError&&<p role="alert">{browserError}</p>}
   {payload?.error_code&&<p role="alert">{errors[payload.error_code]}{snapshot?' 当前保留上次校验通过的参考值。':' 不展示替代或模拟数据。'}</p>}
   {age!==null&&age>7&&<p role="alert">参考日期已超过 7 个日历日，请谨慎使用。这是保守提醒，不是已核验的节假日发布日历。</p>}
   {overdue&&<p>最近来源检查距今超过 1 小时，请查看日期后使用。</p>}
   <p>成功后至少间隔 1 小时（同一服务进程）；失败后至少等待 15 分钟。{next&&!blocked?`下次允许来源检查：${time(payload?.next_check_at??null)}`:''}</p>
  </div><button disabled={loading||blocked||waiting} onClick={()=>void load()}>{loading?'检查中…':blocked?'来源检查已停止':waiting?'等待下次检查':'检查 ECB 来源'}</button></section>
  {snapshot?<div className={s.workspace}>
   <section className={s.converter} aria-labelledby="converter-title"><p className={s.eyebrow}>REFERENCE CONVERSION</p><h2 id="converter-title">交叉汇率换算</h2><p>以同一参考日的 EUR 报价相除计算，仅供研究。</p>
    <label htmlFor="fx-amount">换算数量</label><input id="fx-amount" inputMode="decimal" type="number" min="0" max="1000000000000" step="any" value={amount} onChange={e=>setAmount(e.target.value)}/>
    <div className={s.pair}><div><label htmlFor="fx-from">从</label><select id="fx-from" value={selectedFrom} onChange={e=>setFrom(e.target.value)}>{currencies.map(c=><option key={c} value={c}>{c} · {names[c]??c}</option>)}</select></div><button aria-label="交换换算货币" onClick={()=>{setFrom(selectedTo);setTo(selectedFrom)}}>⇄</button><div><label htmlFor="fx-to">换算为</label><select id="fx-to" value={selectedTo} onChange={e=>setTo(e.target.value)}>{currencies.map(c=><option key={c} value={c}>{c} · {names[c]??c}</option>)}</select></div></div>
    <div className={s.result} aria-live="polite"><span>参考换算结果 · {snapshot.reference_date}</span><strong>{validAmount?`${number(converted)} ${selectedTo}`:'请输入 0 至 1 万亿的有效数量'}</strong><small>{rate!==null?`1 ${selectedFrom} ≈ ${number(rate)} ${selectedTo}`:'该币种未覆盖'}</small></div>
    <p className={s.formula}>计算：目标币 / EUR ÷ 起始币 / EUR × 数量。结果经过显示舍入，不含买卖价差、费用或可交易性保证；不用于合并其他日期的资产或资金流。</p>
   </section>
   <section className={s.rates} aria-labelledby="rates-title"><div className={s.tableHead}><div><p className={s.eyebrow}>SOURCE REFERENCE RATES</p><h2 id="rates-title">1 EUR 对应多少报价币</h2></div><div><label htmlFor="fx-search">筛选货币</label><input id="fx-search" placeholder="CNY、美元…" value={query} onChange={e=>setQuery(e.target.value)}/></div></div>
    <div className={s.tableScroll}><table><caption>欧洲央行 {snapshot.reference_date} 参考汇率 · 显示 {rows.length} / {snapshot.rates.length} 种报价币</caption><thead><tr><th scope="col">货币</th><th scope="col">名称</th><th scope="col">报价币 / EUR</th></tr></thead><tbody>{rows.map(r=><tr key={r.currency}><th scope="row">{r.currency}</th><td>{names[r.currency]??'来源新增币种'}</td><td>{r.per_eur}</td></tr>)}</tbody></table>{rows.length===0&&<p className={s.empty}>没有匹配的已覆盖货币；缺失不表示零。</p>}</div>
   </section>
  </div>:<section className={s.empty}>{loading?'正在读取 ECB 的公开每日 XML…':'尚无通过校验的参考汇率。检查成功后显示真实来源数据，不使用样例填补。'}</section>}
  <footer className={s.footer}><p>来源：European Central Bank（欧洲央行）。<a href={ECB_INFO} target="_blank" rel="noreferrer">官方说明 ↗</a> · <a href={ECB_URL} target="_blank" rel="noreferrer">免费原始 XML ↗</a> · <a href={ECB_RIGHTS} target="_blank" rel="noreferrer">使用条件与免责声明 ↗</a></p><p>获取时间：{time(snapshot?.retrieved_at??null)}。这是本服务完整获取并校验的时间，不是发布时刻；XML 仅提供参考日期。</p><details><summary>来源、换算与使用边界</summary><p>个人研究视图，保留现有站点访问控制。仅展示当次来源列出的货币；EUR = 1 是基准恒等关系，不额外计入报价覆盖。未提供的货币不补零，也不接入其他来源拼接。</p><p>ECB 允许按其条件免费使用网站信息，要求准确呈现并注明来源，修改或换算须明确标注；付费分发还有免费来源告知要求。此处交叉汇率是本应用的计算结果，表格保持来源数字精度。软件开源许可不替代 ECB 数据条款，也不代表 ECB 背书。未改变访问权限或对外发布范围。</p><p>缓存只在服务进程和当前页面内存中保存；不保存账户信息，不提交真实报价到仓库。重启可清空缓存，多个服务进程不共享检查间隔。未核验独立部署环境中的来源可达性。</p></details></footer>
 </main>;
}
