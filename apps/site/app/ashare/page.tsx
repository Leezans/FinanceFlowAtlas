'use client';
import React,{useEffect,useState} from 'react';
import EvidenceHeatmap from '@/components/ashare/EvidenceHeatmap';
import {createEvidenceClient,emptyState,type EvidenceState} from '@/components/ashare/client';
import type {Scope} from '@/components/ashare/model';
const ROOT:Scope={kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'};
function createSession(){
 let abort:AbortController|null=null;
 const client=createEvidenceClient(async({scope:requested,ifNoneMatch})=>{
  abort?.abort();const controller=new AbortController();abort=controller;
  const key=requested.kind==='industry_rank'?'level1':requested.fs.slice(2);
  const response=await fetch(`/api/v1/ashare/snapshot?scope=${encodeURIComponent(key)}`,{signal:controller.signal,cache:'no-store',headers:ifNoneMatch?{'If-None-Match':ifNoneMatch}:{}});
  return {status:response.status,etag:response.headers.get('etag')||undefined,payload:response.status===304?undefined:await response.json().catch(()=>undefined)};
 });
 return {client,cancel:()=>abort?.abort()};
}
export default function AsharePage(){
 const [scope,setScope]=useState<Scope>(ROOT),[industry,setIndustry]=useState(''),[state,setState]=useState<EvidenceState>(emptyState),[loading,setLoading]=useState(false);
 const [{client,cancel}]=useState(createSession);
 useEffect(()=>{
  let live=true,busy=false;
  async function load(){if(busy)return;busy=true;if(live)setLoading(true);const pending=client.load(scope);if(live)setState(client.getState());const next=await pending;if(live){setState(next);setLoading(false)}busy=false}
  const start=setTimeout(()=>void load(),0);const timer=setInterval(()=>void load(),60_000);
  return()=>{live=false;clearTimeout(start);clearInterval(timer);cancel();client.clear()};
 },[client,cancel,scope]);
 return <main style={{minHeight:'100vh',background:'#07111b',padding:'16px',color:'#d9e7ec'}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:12}}><strong>FinanceFlowAtlas · A股</strong><span style={{fontSize:12,color:'#92aabd'}}>个人研究视图</span></div>
  <nav aria-label="市场与行业" style={{display:'flex',gap:10,alignItems:'center',marginBottom:12}}>{scope.kind==='industry_stocks'?<><button style={{background:'#182936',color:'#d9e7ec',border:'1px solid #3c5361',padding:'8px 12px',borderRadius:5}} onClick={()=>{setIndustry('');setScope(ROOT)}}>← 全部一级行业</button><span>{industry}</span></>:<span>东财一级行业</span>}<span role="status" style={{fontSize:12,color:'#92aabd'}}>{loading?'正在获取并核对完整分页…':'每分钟检查一次；不代表行情每分钟更新'}</span></nav>
  <EvidenceHeatmap state={state} onIndustrySelect={(next,row)=>{setIndustry(row.f14);setScope(next)}}/>
  <p style={{fontSize:11,color:'#92aabd'}}>来源：东方财富公开接口。主力净额是供应商订单分类指标，不是市场真实新增资金。数据时点与延迟未由来源提供。</p>
 </main>
}
