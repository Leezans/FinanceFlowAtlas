'use client';
import React,{useEffect,useState,useRef} from 'react';
import EvidenceHeatmap from '@/components/ashare/EvidenceHeatmap';
import SourceRecovery from '@/components/ashare/SourceRecovery';
import MarketTiming from '@/components/ashare/MarketTiming';
import {emptyState,type EvidenceState} from '@/components/ashare/client';
import {createEvidenceSession} from '@/components/ashare/session';
import type {Scope} from '@/components/ashare/model';
const ROOT:Scope={kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'};
export default function AshareWorkspace({embedded=false}:{embedded?:boolean}){
 const [scope,setScope]=useState<Scope>(ROOT),[industry,setIndustry]=useState(''),[state,setState]=useState<EvidenceState>(emptyState),[loading,setLoading]=useState(false);
 const [{client,cancel}]=useState(createEvidenceSession);
 const retry=useRef<()=>void>(()=>{});
 useEffect(()=>{
  let live=true,busy=false,timer:ReturnType<typeof setTimeout>|undefined,scheduledFor:number|undefined;
  function schedule(delay:number){if(timer!==undefined)clearTimeout(timer);if(live){scheduledFor=Date.now()+delay;timer=setTimeout(()=>{timer=undefined;void load();},delay);}}
  async function load(){
   if(!live||busy)return;
   if(!client.canLoad(scope)){if(timer===undefined&&client.getState().recovery?.mode!=='stopped')schedule(60_000);return;}
   if(timer!==undefined){clearTimeout(timer);timer=undefined;}scheduledFor=undefined;
   busy=true;setLoading(true);const pending=client.load(scope);setState(client.getState());const next=await pending;busy=false;
   if(!live)return;
   setState(next);setLoading(false);
   if(next.recovery?.mode==='stopped')return;
   // One timer and one in-flight request per selected scope. Staged pages keep
   // their server cooldown; healthy caches schedule from their remaining TTL.
   // The fallback preserves older-server and temporary-failure minute checks.
   const deadline=next.recovery?.code==='collection_in_progress'&&next.recovery.mode==='retry'
    ?next.recovery.retryAt:!next.recovery?next.nextCheckAt:undefined;
   schedule(deadline!==undefined&&deadline!==null?Math.max(1000,deadline-Date.now()+100):60_000);
  }
  // A suspended tab may resume before its throttled timer is delivered. Only
  // catch up an overdue check; focus never shortens a hint/cooldown or a stop.
  const resume=()=>{if(document.visibilityState==='visible'&&scheduledFor!==undefined&&Date.now()>=scheduledFor)void load();};
  window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);
  retry.current=()=>void load();schedule(0);
  return()=>{live=false;if(timer!==undefined)clearTimeout(timer);window.removeEventListener('focus',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume);cancel();client.clear()};
 },[client,cancel,scope]);
 return <section aria-label="A 股行业与个股矩阵工作区" style={{minHeight:embedded?undefined:'100vh',background:'#07111b',padding:embedded?'0':'16px',color:'#d9e7ec'}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:12}}><strong>FinanceFlowAtlas · A股</strong><span style={{fontSize:12,color:'#92aabd'}}>个人研究视图</span></div>
  <nav aria-label="市场与行业" style={{display:'flex',gap:10,alignItems:'center',marginBottom:12}}>{scope.kind==='industry_stocks'?<><button style={{background:'#182936',color:'#d9e7ec',border:'1px solid #3c5361',padding:'8px 12px',borderRadius:5}} onClick={()=>{setIndustry('');setScope(ROOT)}}>← 全部一级行业</button><span>{industry}</span></>:<span>东财一级行业</span>}<span role="status" style={{fontSize:12,color:'#92aabd'}}>{loading?'正在获取并核对完整分页…':state.recovery?.mode==='stopped'?'来源检查已停止':state.recovery?.code==='collection_in_progress'?'正在核对完整分页；未发布部分数据':state.recovery?'等待恢复；不代表行情更新':'页面打开时约每分钟检查；不代表行情更新'}</span></nav>
  <p aria-label="采集触发方式" style={{fontSize:12,color:'#92aabd'}}>页面访问触发采集；关闭后不会继续后台更新。浏览器休眠可能延迟检查，返回页面后补查已到期请求，仍遵守来源冷却或停止状态。</p>
  <EvidenceHeatmap state={state} onIndustrySelect={(next,row)=>{setIndustry(row.f14);setScope(next)}}/>
  <SourceRecovery state={state} scope={scope} loading={loading} onRetry={()=>retry.current()}/>
  <MarketTiming state={state} loading={loading}/>
  <p style={{fontSize:11,color:'#92aabd'}}>来源：东方财富公开接口。主力净额是供应商订单分类指标，不是市场真实新增资金。数据时点与延迟未由来源提供。</p>
 </section>
}
