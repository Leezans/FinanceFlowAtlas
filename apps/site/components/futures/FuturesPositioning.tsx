'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {CFTC_DATASET,CFTC_SCHEDULE,CONTRACTS,DAY_MS,REFRESH_MS,STALE_REPORT_DAYS,replySchema,visibleSnapshot,reportAge,net,type CftcReply} from '@/lib/futures/model';
import OrganizedEvidence from '@/components/evidence/OrganizedEvidence';
import {projectCftcReport} from '@/lib/evidence/cftc-projection';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {futuresMatrixGroups,TRADER_GROUPS,type TraderGroup} from './matrix';
import s from './futures.module.css';
const number=(n:number)=>n.toLocaleString('zh-CN');
const signed=(n:number)=>`${n>0?'+':''}${number(n)}`;
const timestamp=(t:string|null)=>t?t.replace('T',' ').replace('Z',' UTC'):'未提供';
export default function FuturesPositioning(){
 const [data,setData]=useState<CftcReply|null>(null),[loading,setLoading]=useState(false),[failure,setFailure]=useState<'network'|'permission'|'invalid'|null>(null),[now,setNow]=useState(0),[group,setGroup]=useState<TraderGroup>('noncommercial'),[selectedCode,setSelectedCode]=useState('088691');
 const active=useRef<AbortController|null>(null),mounted=useRef(false),blocked=useRef(false);
 const refresh=useCallback(async()=>{
  if(active.current||blocked.current)return;
  const controller=new AbortController();active.current=controller;setLoading(true);
  const timeout=setTimeout(()=>controller.abort(),20_000);
  try{
   const response=await fetch('/api/v1/futures/cftc/snapshot',{credentials:'same-origin',cache:'no-store',redirect:'manual',signal:controller.signal});
   if(response.status===401||response.status===403||response.type==='opaqueredirect'||response.redirected||response.status>=300&&response.status<400){if(mounted.current&&active.current===controller){blocked.current=true;setData(null);setFailure('permission');}return;}
   let result:CftcReply;
   try{result=replySchema.parse(await response.json());if(response.redirected||![200,503].includes(response.status))throw new Error('invalid_response');}
   catch(error){if(response.status>=500&&response.status<=599)throw error;if(mounted.current&&active.current===controller){setData(null);setFailure('invalid');}return;}
   if(mounted.current&&active.current===controller){blocked.current=result.status.state==='denied';setData(result);setFailure(null);setNow(Date.now());}
  }catch{if(mounted.current&&active.current===controller){setFailure('network');setNow(Date.now());}}
  finally{clearTimeout(timeout);if(active.current===controller){active.current=null;if(mounted.current)setLoading(false);}}
 },[]);
 useEffect(()=>{
  mounted.current=true;const start=setTimeout(()=>{setNow(Date.now());void refresh();},0);
  const tick=setInterval(()=>setNow(Date.now()),30_000),poll=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},REFRESH_MS);
  const visible=()=>{setNow(Date.now());if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);
  return()=>{mounted.current=false;clearTimeout(start);clearInterval(tick);clearInterval(poll);document.removeEventListener('visibilitychange',visible);active.current?.abort();active.current=null;};
 },[refresh]);
 const snapshot=visibleSnapshot(data,now),days=snapshot?reportAge(snapshot,now):null,denied=data?.status.state==='denied';
 const stale=!!snapshot&&(failure==='network'||data?.status.state==='stale'||now-Date.parse(snapshot.fetched_at)>REFRESH_MS||days!>STALE_REPORT_DAYS);
 const organized=useMemo(()=>projectCftcReport(snapshot,stale),[snapshot,stale]);
 const groupLabel=TRADER_GROUPS.find(g=>g.id===group)!.label;
 const matrixGroups=snapshot?futuresMatrixGroups(snapshot,group):[];
 const legacy=snapshot?.schema==='cftc-legacy-futures/1';
 const selectedRow=snapshot?.rows.find(row=>row.code===selectedCode)??null;
 return <div className={s.surface}><main className={s.root}>
  <header className={s.header}><a href="/markets">◉ Finance Flow Atlas</a><a href="/ashare">A 股热力图 ↗</a></header>
  <section className={s.intro}><p className={s.eyebrow}>FUTURES / CFTC COMMITMENTS OF TRADERS</p><h1>期货品类持仓矩阵</h1><p><a href="/futures/taiwan">查看台湾法人期货日度名义金额矩阵</a></p><p className={s.subtitle}>目标覆盖 52 个精选美国 CFTC 报告市场 · 官方公开数据 · 不需要账户或密钥</p><p className={s.notice}>这是有发布滞后的定期持仓报告，不是实时资金流。多头减空头是该类交易者的净持仓；持仓变化不等于资金净流入。</p></section>
  <section className={s.status} aria-live="polite"><div><strong>{failure==='permission'?'展示权限已失效':denied?'来源访问已停止':loading&&!snapshot?'正在获取 CFTC 报告':snapshot?stale?'已保留报告 · 请注意陈旧状态':'已取得可校验报告':'暂无可验证的持仓报告'}</strong><p>{failure==='permission'?'已清空浏览器证据并停止检查。':failure==='invalid'?'响应未通过完整校验，已清空浏览器证据。':denied?'来源拒绝访问后停止自动请求，不切换路径。':failure==='network'?'连接失败；仅保留未超过展示期限的已校验报告。':'页面可见时每小时检查，服务器遵守共享冷却；关闭页面不承诺后台采集。通常为周度报告，实际观测日期以报告为准。获取成功不表示数据实时。'}</p>{data?.status.error_code&&<small>{data.status.error_code}</small>}</div><button onClick={()=>void refresh()} disabled={loading||denied||failure==='permission'}>{loading?'正在检查…':'检查报告'}</button></section>
  <div className={s.times}><span>持仓观测日期<b>{snapshot?.rows[0].current.date??'暂无报告'}</b></span><span>距观测日期<b>{days===null?'未知':`${Math.floor(days)} 天（按 UTC 日期计算）`}</b></span><span>来源实际发布时间<b>接口未提供</b></span><span>最近成功获取<b>{timestamp(snapshot?.fetched_at??data?.status.fetched_at??null)}</b></span></div>
  {snapshot?<>
   <p className={s.notice} role="status">{legacy?'当前保留旧版 4 市场报告；52 市场扩展尚未取得完整可校验报告。':'已验证 52 / 52 个市场 · 8 个品类 · 每个市场的本期和前期报告完整。'} 当前展示 {snapshot.rows.length} 个市场、{matrixGroups.length} 个品类。这里是美国 CFTC 报告的期货市场持仓，不是全球期货全覆盖。</p>
   <section className={s.toolbar} aria-label="选择交易者类别"><div><h2>按品类看多空持仓</h2><p>金属、能源、农产品、畜牧、外汇、利率、股指及加密期货是本页品类导航，不是 CFTC 行业分类；每类只覆盖下列精选市场。</p></div><div className={s.groups}>{TRADER_GROUPS.map(g=><button key={g.id} aria-pressed={group===g.id} onClick={()=>setGroup(g.id)}>{g.label}</button>)}</div></section>
   <MatrixHeatmap layout="readable-grid" groups={matrixGroups} title="精选美国期货品类矩阵" description={`${groupLabel} · ${snapshot.rows[0].current.date}。点击品种查看合约张数、前期变化与口径。`} colorMeaning="净持仓 ÷ 该市场未平仓量（OI），固定 −100% 至 +100%；正值是净多头，负值是净空头。不是资金流。" areaMeaning="无可比较金额：合约张数不转换为金额，每个品种等面积；不代表成交额、合约规模或品类资金总量。0 表示多空相等，不表示没有持仓。" colorMaxAbs={1} onSelect={item=>setSelectedCode(item.id)}/>
   <section className={s.detailSection} aria-label="选中期货品种详情" aria-live="polite">{selectedRow&&(()=>{
    const row=selectedRow;
    const c=CONTRACTS.find(c=>c.code===row.code)!,value=net(row.current,group),previous=net(row.previous,group),pct=value/row.current.open_interest*100,delta=value-previous;
    const interval=(Date.parse(row.current.date)-Date.parse(row.previous.date))/DAY_MS;
    return <article className={s.card} key={row.code}>
     <p className={s.detailEyebrow}>选中品种 · 点击矩阵可切换</p>
     <div className={s.cardTitle}><div><p>{c.venue} · {row.code}</p><h3>{c.label}</h3></div><span>{c.unitLabel}</span></div>
     <p className={s.label}>{groupLabel} · 净持仓</p><div className={`${s.value} ${value<0?s.negative:value>0?s.positive:s.zero}`}>{signed(value)}<small>张合约</small></div>
     <p className={s.normalized}>{pct.toFixed(1)}% OI <span>净持仓占该市场未平仓量</span></p>
     <div className={s.change}><div><span>{interval===7?'较前一期（7 天）':'较前一期'}净持仓变化</span><strong>{signed(delta)} <small>张</small></strong></div><p>{row.previous.date} → {row.current.date} · 间隔 {interval} 天</p></div>
     <dl className={s.stats}><div><dt>{groupLabel}多头</dt><dd>{number(row.current[`${group}_long`])} 张</dd></div><div><dt>{groupLabel}空头</dt><dd>{number(row.current[`${group}_short`])} 张</dd></div><div><dt>该市场未平仓量</dt><dd>{number(row.current.open_interest)} 张</dd></div></dl>
     <details><summary>口径与合约信息</summary><p>{row.market_name}</p><p>{row.contract_units}</p><p>非商业跨期等价多空（spreading）：{number(row.current.spreading)} 张，已在 OI 平衡校验中分别计入多空两侧；不加入方向性净持仓。</p><p>所有到期月份汇总。这里只含期货，不含期权，也不是全球该商品或外汇市场。</p></details>
    </article>;
   })()}</section>
  </>:<MatrixHeatmap layout="readable-grid" groups={[]} title="精选美国期货品类矩阵" description="数据缺失时，不填入示例。" colorMeaning="有有效报告时以净持仓占 OI 比例着色，不表示资金流。" areaMeaning="每个已核验品种等面积，不合计不同合约。" emptyMessage="52 个市场的本期和前期记录全部通过合约、单位、共同报告日期和多空平衡校验后才发布新报告。旧版缓存只按原 4 市场范围展示。报告超过 35 天或获取缓存超过 24 小时后停止展示。"/>}
  <OrganizedEvidence report={organized} onDownload={event=>{
   const current=Date.now();
   // Recheck the exact existing visibility selector if a suspended tab clicks
   // before its clock has ticked. Permission stops also withdraw the Blob.
   if(blocked.current||failure==='permission'||failure==='invalid'||visibleSnapshot(data,current)!==snapshot){event.preventDefault();setNow(current);}
  }}/>
  <section className={s.sources}><h2>先理解口径，再看变化。</h2><ul><li>Legacy Futures Only 把持仓分为商业、非商业和非报告持仓。分类依据报告规则，不能直接称为“聪明钱”或买卖信号。</li><li>商业与非商业持仓用于不同目的，净多头不保证看涨或获利。持仓变化还可能受移仓、平仓、分类变化或数据修订影响。</li><li>单位是各市场的合约张数，合约规模不同，不相加、不换算名义美元，不把任何期货持仓扩展为全球资金流；股指、外汇和加密期货也不是股票现货、即期外汇或加密现货。</li><li>传统周度安排通常为周二持仓、周五 15:30 美东时间发布；假日会延后。CFTC 已宣布计划在 2026 年底前增加发布频率，本页始终显示实际日期和间隔，不猜测发布时间。</li><li>报告距观测日期超过 10 天提示陈旧，这是本应用的保守阈值，不是来源发布 SLA。官方 API 没有给每条记录的实际发布时间；获取时间与发布时间不同。</li></ul><div className={s.links}><a href={CFTC_DATASET} target="_blank" rel="noreferrer">CFTC 官方数据集 ↗</a><a href={CFTC_SCHEDULE} target="_blank" rel="noreferrer">官方发布日历 ↗</a><a href="https://www.cftc.gov/MarketReports/CommitmentsofTraders/ExplanatoryNotes/index.htm" target="_blank" rel="noreferrer">字段与分类说明 ↗</a><a href="https://www.cftc.gov/PressRoom/PressReleases/9316-26" target="_blank" rel="noreferrer">2026 年频率变更计划 ↗</a></div></section>
 </main></div>;
}
