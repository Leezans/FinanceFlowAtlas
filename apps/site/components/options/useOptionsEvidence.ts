'use client';
import {useMemo} from 'react';
import {replySchema,visibleSnapshot,REFRESH_MS,type OptionsReply} from '@/lib/options/model';
import type {DeribitInputSchema} from '@/lib/evidence/deribit-projection';
import {useReport} from '@/components/markets/useReport';
// Preserve the wire schema before the legacy reader normalizes the snapshot.
const parseReply=(payload:unknown):OptionsReply & {inputSchema:DeribitInputSchema|null}=>{
 const result=replySchema.parse(payload);
 return {...result,inputSchema:(payload as {snapshot:{schema:DeribitInputSchema}|null}).snapshot?.schema??null};
};
export function useOptionsEvidence(){
 const {reply:data,now,setNow,loading,failure,refresh,coolingDown}=useReport('/api/v1/options/deribit/snapshot',parseReply,REFRESH_MS,20_000,1000);
 const stopped=failure==='permission'||data?.status.state==='denied';
 const problem=failure==='permission'?'展示权限已失效':data?.status.state==='denied'?'来源访问已停止':failure==='invalid'?'响应数据未通过校验，已清空浏览器行情。':failure==='network'?'更新失败 · 上次有效快照已陈旧':'';
 const inputSchema=data?.inputSchema??null;
 // The selector still runs each tick. Only memoize the identical active row set,
 // so an unchanged one-second clock does not rebuild the complete local Blob.
 const visible=visibleSnapshot(data,now),activeInstruments=visible?.rows.map(row=>row.instrument).join('|')??'';
 const snapshot=useMemo(()=>{
  if(!data?.snapshot||!activeInstruments)return null;
  const names=new Set(activeInstruments.split('|'));
  return {...data.snapshot,rows:data.snapshot.rows.filter(row=>names.has(row.instrument))};
 },[data,activeInstruments]);
 const stale=!!snapshot&&(!!problem||data?.status.state==='stale'||now-Date.parse(snapshot.fetched_at)>REFRESH_MS||now-Date.parse(snapshot.source_as_of)>REFRESH_MS);
 const provenance=useMemo(()=>({input_schema:inputSchema,source_instrument_count:data?.snapshot?.rows.length??null}),[inputSchema,data]);
 const validateDownload=()=>{
  const current=Date.now(),eligible=visibleSnapshot(data,current);
  const currentStale=!!eligible&&(!!problem||data?.status.state==='stale'||current-Date.parse(eligible.fetched_at)>REFRESH_MS||current-Date.parse(eligible.source_as_of)>REFRESH_MS);
  // A suspended tab can miss a tick. Withdraw a file containing even one newly
  // expired instrument, not only a fully expired snapshot, before the browser saves it.
  const allowed=!stopped&&!!eligible&&eligible.rows.map(row=>row.instrument).join('|')===activeInstruments&&currentStale===stale;
  if(!allowed)setNow(current);
  return allowed;
 };
 return {snapshot,loading,problem,blocked:stopped,coolingDown,refresh,stale,provenance,validateDownload};
}
