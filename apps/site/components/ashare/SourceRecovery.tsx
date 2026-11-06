'use client';
import React,{useEffect,useState} from 'react';
import type {EvidenceState} from './client';
import type {Scope} from './model';
import {describeRecovery,isSourceStopped} from '@/lib/ashare/recovery';
import './recovery.css';
export default function SourceRecovery({state,scope,loading,onRetry}:{state:EvidenceState;scope:Scope;loading:boolean;onRetry:()=>void}) {
 const issue=state.recovery;
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{
  if(!issue||issue.mode==='stopped')return;
  const tick=()=>setNow(Date.now());const start=setTimeout(tick,0);const timer=setInterval(tick,1000);
  window.addEventListener('focus',tick);
  return()=>{clearTimeout(start);clearInterval(timer);window.removeEventListener('focus',tick);};
 },[issue]);
 if(!issue)return null;
 const info=issue.mode==='stopped'&&!isSourceStopped(issue.code)?{stage:'采集已停止',message:'来源访问已停止。',action:'当前服务要求停止采集，需要维护者核查；不提供重试或绕过限制。'}:describeRecovery(issue.code),seconds=issue.retryAt===null?0:Math.max(0,Math.ceil((issue.retryAt-now)/1000));
 return <section className="ashare-recovery" aria-label="来源连接与恢复">
  <div className="recovery-summary"><p role="status"><strong>{issue.code==='browser_network'||issue.code==='browser_timeout'?'应用连接':'东方财富'} · {info.stage}</strong><span>{info.message} {state.snapshot?'保留本页上次核对完整的快照，当前不是新行情。':'尚无可显示的完整快照。'}</span></p>
   {issue.mode==='retry'&&<button type="button" onClick={onRetry} disabled={loading||seconds>0} aria-label="重试当前来源">{loading?'正在重试…':seconds>0?`${seconds} 秒后可重试`:'重试当前来源'}</button>}
  </div>
  <details><summary>故障详情与处理建议</summary><dl>
   <div><dt>数据来源</dt><dd>东方财富 · {scope.kind==='industry_rank'?'一级行业':`行业成分股 ${scope.fs.slice(2)}`}</dd></div>
   <div><dt>故障代码</dt><dd>{issue.code}{issue.httpStatus?` · HTTP ${issue.httpStatus}`:''}</dd></div>
   <div><dt>处理建议</dt><dd>{info.action}</dd></div>
  </dl><p>{issue.mode==='stopped'?'已停止自动检查，不提供强制重试。':issue.code==='collection_in_progress'?'冷却结束后自动续取剩余分页；超出采集窗口，或检测到数量、排序或代码不一致时，整次采集作废。':'冷却结束后可手动重试，页面也会按原有一分钟节奏检查。重试不跳过完整性校验或服务端限速。'}</p></details>
 </section>;
}
