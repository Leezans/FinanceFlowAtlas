'use client';
import React,{lazy,Suspense,useState} from 'react';
import OrganizedEvidence from '@/components/evidence/OrganizedEvidence';
import {projectTaiwanReport} from '@/lib/evidence/report-projection';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {TPEX_SUMMARY_DATASET,TPEX_SUMMARY_LICENSE,type TpexSummaryParticipant} from '@/lib/national/tpex-summary';
import {SUMMARY_REFRESH_MS,summaryReplySchema,visibleSummary,summaryReportAge,summaryGroups,summaryMoney,participantLabels} from '@/lib/national/tpex-summary-view';
import {TPEX_SUMMARY_STALE_DAYS} from '@/lib/national/tpex-summary-policy';
import {useReport} from './useReport';
import s from './markets.module.css';

const TpexInstitutional=lazy(()=>import('@/components/tpex/TpexInstitutional'));
const parse=(value:unknown)=>summaryReplySchema.parse(value);
const stamp=(value:string|null|undefined)=>value?value.replace('T',' ').replace('Z',' UTC'):'未取得';
export default function TaiwanMoney(){
  const {reply,loading,failure,now,refresh,nextDeadline,coolingDown}=useReport('/api/v1/taiwan/tpex/summary/snapshot',parse,SUMMARY_REFRESH_MS);
  const [participant,setParticipant]=useState<TpexSummaryParticipant|null>(null),[industryOpen,setIndustryOpen]=useState(false);
  const snapshot=visibleSummary(reply,now),denied=reply?.status.state==='denied'||failure==='permission';
  const stale=!!snapshot&&(failure==='network'||reply?.status.state==='stale'||now-Date.parse(snapshot.fetched_at)>SUMMARY_REFRESH_MS||summaryReportAge(snapshot,now)>TPEX_SUMMARY_STALE_DAYS);
  const nextCheck=nextDeadline>0?(Number.isFinite(nextDeadline)&&nextDeadline<=8.64e15?stamp(new Date(nextDeadline).toISOString()):'来源要求暂停，恢复时间超出可显示范围'):'未取得';
  const total=snapshot?.participants.find(row=>row.id==='total'),selected=snapshot?.participants.find(row=>row.id===participant);
  return <section aria-label="台湾上柜自身市场净买卖金额">
    <div className={s.ownStatus} role="status"><div><strong>{denied?'来源访问已停止，金额保持空白':loading&&!snapshot?'正在核验本地市场来源':snapshot?stale?'保留最近已核验报告 · 注意时效':'已取得每日法人交易报告':'暂无可核验的本地交易金额'}</strong>
      <p>{denied?'沿用来源的停止状态，不切换接口绕过限制。':failure==='invalid'?'响应未通过校验，已清空金额。':failure==='network'?'连接失败；仅保留仍有效的已核验报告，获取时间不更新。':'页面可见时按来源许可检查官方日报，正常间隔 1 小时；更长暂停会保留。交易日、获取时间与实际发布时间分别展示；不是实时资金流。'}</p>
    </div><button onClick={()=>void refresh()} disabled={loading||denied||coolingDown}>{loading?'正在检查…':'检查报告'}</button></div>
    <div className={s.ownTimes}><span>交易资料日期 <b>{snapshot?.report_date??'未取得'}</b></span><span>来源实际发布时间 <b>接口未提供</b></span><span>最近成功获取 <b>{stamp(snapshot?.fetched_at)}</b></span><span>下次可检查 <b>{denied?'已停止':nextCheck}</b></span><span>最近尝试 <b>{stamp(reply?.status.last_attempt_at)}</b></span></div>
    {total&&<div className={s.ownNet}><span>三大法人合计 · {total.net>0?'净买入':total.net<0?'净卖出':'已报告零净额'}</span><strong>{summaryMoney(total.net)}</strong><span>仅来源参与者，不是整个市场新增资金</span></div>}
    <MatrixHeatmap groups={summaryGroups(snapshot)} title="台湾上柜 · 法人净买卖金额矩阵" description={`${snapshot?.report_date??'等待来源报告'} · 新台币 TWD · 来源未提供行业金额`} colorMeaning="红色净买入、绿色净卖出；颜色强度按当前参与者净额绝对值。" areaMeaning="同日三类法人净额绝对值（TWD）；合计单独显示，不重复占面积。" scopeKey={`tpex-money:${snapshot?.report_date??'empty'}`} selectedItemId={participant??undefined} onSelect={item=>setParticipant(item.id as TpexSummaryParticipant)} emptyTitle="台湾上柜资金金额暂无可用报告" emptyMessage="仅显示通过校验且允许访问的官方金额。来源不可用或停止时保留空白，不用美国 TIC、股数乘股价或旧时点冒充。"/>
    {selected&&<section className={s.participantDetail} aria-label="所选法人金额证据"><h3>{participantLabels[selected.id]}</h3><dl><div><dt>买进金额</dt><dd>{summaryMoney(selected.buy)}</dd></div><div><dt>卖出金额</dt><dd>{summaryMoney(selected.sell)}</dd></div><div><dt>净买卖金额</dt><dd>{summaryMoney(selected.net)}</dd></div></dl><p className={s.ownFootnote}>{snapshot?.report_date} · 正值表示该类参与者净买入，负值净卖出。不代表全国国际收支流入 / 流出。</p></section>}
    <p className={s.ownFootnote}>证券范围按 TPEx 官方三大法人汇总，不限于已匹配行业的上柜公司，不包含台湾全部市场。外资使用不含自营商的行，避免与自营商重复计算。来源没有行业金额，不将法人金额分摊成行业资金流。</p>
    <details className={s.ownDisclosure} open={industryOpen} onToggle={event=>setIndustryOpen(event.currentTarget.open)}><summary>行业 → 公司矩阵 · 独立股数指标，不是上述金额的下钻</summary>{industryOpen&&<Suspense fallback={<p role="status">正在打开独立行业股数报告…</p>}><TpexInstitutional embedded/></Suspense>}</details>
    <details className={s.ownDisclosure}><summary>官方来源、授权与时效</summary><p><a href={TPEX_SUMMARY_DATASET} target="_blank" rel="noreferrer">TPEx 上柜股票三大法人买卖金额汇总表 ↗</a> · <a href={TPEX_SUMMARY_LICENSE} target="_blank" rel="noreferrer">政府资料开放授权条款第 1 版 ↗</a></p><p>资料来源：证券柜台买卖中心（TPEx）。金额单位为新台币元，本应用仅整理参与者分类及绘图，来源不背书本应用。超过 4 天标记陈旧；报告超过 14 天或获取缓存超过 24 小时后隐藏金额。页面关闭后没有后台采集。</p></details>
    <OrganizedEvidence report={projectTaiwanReport(snapshot,stale)}/>
  </section>;
}
