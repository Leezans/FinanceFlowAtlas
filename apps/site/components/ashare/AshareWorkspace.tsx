'use client';
import React,{useEffect,useState,useRef} from 'react';
import EvidenceHeatmap from '@/components/ashare/EvidenceHeatmap';
import SourceRecovery from '@/components/ashare/SourceRecovery';
import MarketTiming from '@/components/ashare/MarketTiming';
import {createEvidenceClient,emptyState,type EvidenceState} from '@/components/ashare/client';
import type {Scope} from '@/components/ashare/model';
const ROOT:Scope={kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'};
function createSession(){
 let abort:AbortController|null=null;
 const client=createEvidenceClient(async({scope:requested,ifNoneMatch})=>{
  abort?.abort();const controller=new AbortController();abort=controller;
  const key=requested.kind==='industry_rank'?'level1':requested.fs.slice(2);
  const response=await fetch(`/api/v1/ashare/snapshot?scope=${encodeURIComponent(key)}`,{signal:controller.signal,cache:'no-store',headers:ifNoneMatch?{'If-None-Match':ifNoneMatch}:{}});
  return {refreshAfter:response.headers.get('x-ashare-refresh-after')||undefined,errorCode:response.headers.get('x-ashare-error-code')||undefined,recoveryMode:response.headers.get('x-ashare-recovery')||undefined,retryAfter:response.headers.get('retry-after')||undefined,status:response.status,etag:response.headers.get('etag')||undefined,payload:response.status===304?undefined:await response.json().catch(()=>undefined)};
 });
 return {client,cancel:()=>abort?.abort()};
}
export default function AshareWorkspace({embedded=false}:{embedded?:boolean}){
 const [scope,setScope]=useState<Scope>(ROOT),[industry,setIndustry]=useState(''),[state,setState]=useState<EvidenceState>(emptyState),[loading,setLoading]=useState(false);
 const [{client,cancel}]=useState(createSession);
 const retry=useRef<()=>void>(()=>{});
 useEffect(()=>{
  let live=true,busy=false,timer:ReturnType<typeof setTimeout>|undefined;
  function schedule(delay:number){if(timer!==undefined)clearTimeout(timer);if(live)timer=setTimeout(()=>{timer=undefined;void load();},delay);}
  async function load(){
   if(!live||busy)return;
   if(!client.canLoad(scope)){if(timer===undefined&&client.getState().recovery?.mode!=='stopped')schedule(60_000);return;}
   if(timer!==undefined){clearTimeout(timer);timer=undefined;}
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
  retry.current=()=>void load();schedule(0);
  return()=>{live=false;if(timer!==undefined)clearTimeout(timer);cancel();client.clear()};
 },[client,cancel,scope]);
 return <section aria-label="A 股行业与个股矩阵工作区" style={{minHeight:embedded?undefined:'100vh',background:'#07111b',padding:embedded?'0':'16px',color:'#d9e7ec'}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:12}}><strong>FinanceFlowAtlas · A股</strong><span style={{fontSize:12,color:'#92aabd'}}>个人研究视图</span></div>
  <nav aria-label="市场与行业" style={{display:'flex',gap:10,alignItems:'center',marginBottom:12}}>{scope.kind==='industry_stocks'?<><button style={{background:'#182936',color:'#d9e7ec',border:'1px solid #3c5361',padding:'8px 12px',borderRadius:5}} onClick={()=>{setIndustry('');setScope(ROOT)}}>← 全部一级行业</button><span>{industry}</span></>:<span>东财一级行业</span>}<span role="status" style={{fontSize:12,color:'#92aabd'}}>{loading?'正在获取并核对完整分页…':state.recovery?.mode==='stopped'?'来源检查已停止':state.recovery?.code==='collection_in_progress'?'正在核对完整分页；未发布部分数据':state.recovery?'等待恢复；不代表行情更新':'每分钟检查一次；不代表行情每分钟更新'}</span></nav>
  <EvidenceHeatmap state={state} onIndustrySelect={(next,row)=>{setIndustry(row.f14);setScope(next)}}/>
  <SourceRecovery state={state} scope={scope} loading={loading} onRetry={()=>retry.current()}/>
  <MarketTiming state={state} loading={loading}/>
  <p style={{fontSize:11,color:'#92aabd'}}>来源：东方财富公开接口。主力净额是供应商订单分类指标，不是市场真实新增资金。数据时点与延迟未由来源提供。</p>
 </section>
}
