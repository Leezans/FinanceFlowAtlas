 'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {FLOW_DATASET,COMPANY_DATASET,LICENSE,PARTICIPANTS,REFRESH_MS,STALE_REPORT_DAYS,replySchema,visibleSnapshot,reportAge,type TpexReply,type Participant} from '@/lib/tpex/model';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {industries,industryLabel,signed,tpexMatrixGroups} from './matrix';
import {INDUSTRY_REFERENCE} from '@/lib/tpex/industries';
import s from './tpex.module.css';
const timestamp=(t:string|null)=>t?t.replace('T',' ').replace('Z',' UTC'):'未提供';
export default function TpexInstitutional(){
 const [data,setData]=useState<TpexReply|null>(null),[loading,setLoading]=useState(false),[failure,setFailure]=useState<'network'|'permission'|'invalid'|null>(null),[now,setNow]=useState(0),[participant,setParticipant]=useState<Participant>('total'),[industry,setIndustry]=useState<string|null>(null),[selectedCode,setSelectedCode]=useState<string|null>(null);
 const active=useRef<AbortController|null>(null),mounted=useRef(false),blocked=useRef(false);
 const refresh=useCallback(async()=>{
  if(active.current||blocked.current)return;
  const controller=new AbortController();active.current=controller;setLoading(true);
  const timeout=setTimeout(()=>controller.abort(),30_000);
  try{
   const response=await fetch('/api/v1/taiwan/tpex/snapshot',{credentials:'same-origin',cache:'no-store',redirect:'manual',signal:controller.signal});
   if(response.status===401||response.status===403||response.type==='opaqueredirect'||response.redirected||response.status>=300&&response.status<400){if(mounted.current&&active.current===controller){blocked.current=true;setData(null);setFailure('permission');}return;}
   let result:TpexReply;
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
 const allIndustries=snapshot?industries(snapshot,participant):[];
 const activeIndustry=allIndustries.find(g=>g.code===industry)??null;
 const selected=snapshot?.rows.find(r=>r.code===selectedCode&&r.industry_code===industry)??null;
 const participantLabel=PARTICIPANTS.find(p=>p.id===participant)!.label;
 const matched=snapshot?.rows.filter(r=>r.flow!==null).length??0;
 return <div className={s.surface}><main className={s.root}>
  <header className={s.header}><a href="/markets">◉ Finance Flow Atlas</a><a href="/ashare">A 股热力图 ↗</a></header>
  <section className={s.intro}><p className={s.eyebrow}>TAIWAN OTC / TPEX OPEN DATA</p><h1>台股上柜 · 法人行业矩阵</h1><p className={s.subtitle}>官方行业 → 公司下钻 · 免费开放数据 · 无需账户或密钥</p><p className={s.notice}>仅台湾 TPEx 上柜公司。三大法人买卖超是特定参与者的净交易股数，不是全市场资金净流入，也不含 TWSE 上市市场。不把股数换算成金额。</p></section>
  <section className={s.status} aria-live="polite"><div><strong>{failure==='permission'?'展示权限已失效':denied?'来源访问已停止':loading&&!snapshot?'正在获取 TPEx 官方报告':snapshot?stale?'已保留报告 · 请注意陈旧状态':'已取得可校验报告':'暂无可验证的法人行业报告'}</strong><p>{failure==='permission'?'已清空浏览器证据并停止检查。':failure==='invalid'?'响应未通过校验，已清空浏览器证据。':denied?'来源拒绝访问后停止自动请求，不切换路径。':failure==='network'?'连接失败，仅保留仍在展示期限内的已校验报告。':'每日源数据，每小时检查。获取时间不代表实时行情或官方发布时间。'}</p>{data?.status.error_code&&<small>{data.status.error_code}</small>}</div><button onClick={()=>void refresh()} disabled={loading||denied||failure==='permission'}>{loading?'正在检查…':'检查报告'}</button></section>
  <div className={s.times}><span>交易资料日期<b>{snapshot?.report_date??'暂无报告'}</b></span><span>行业分类出表日期<b>{snapshot?.classification_date??'暂无分类'}</b></span><span>来源实际发布时间<b>接口未提供</b></span><span>最近成功获取<b>{timestamp(snapshot?.fetched_at??data?.status.fetched_at??null)}</b></span></div>
  {snapshot&&<>
   <div className={s.coverage}><span><b>{matched} / {snapshot.rows.length}</b> 家公司有报告</span><span><b>{snapshot.rows.length-matched}</b> 家缺少法人记录</span><span><b>{allIndustries.length}</b> 个官方产业代码</span><span><b>{snapshot.excluded_security_count}</b> 条证券记录未匹配公司分类，排除</span></div>
   <section className={s.toolbar} aria-label="选择法人类别"><div><h2>{participantLabel}</h2><p>先选行业，再看公司。行业合计仅加总有报告的公司，不补齐缺失记录。</p></div><div className={s.groups}>{PARTICIPANTS.map(p=><button key={p.id} aria-pressed={participant===p.id} onClick={()=>setParticipant(p.id)}>{p.label}</button>)}</div></section>
   <div className={s.filter}><button disabled={industry===null} onClick={()=>{setIndustry(null);setSelectedCode(null);}}>← 全部行业</button><label htmlFor="tpex-industry">行业</label><select id="tpex-industry" value={industry??''} onChange={e=>{setIndustry(e.target.value||null);setSelectedCode(null);}}><option value="">全部行业</option>{allIndustries.map(g=><option key={g.code} value={g.code}>{g.label} · {g.known}/{g.rows.length} 家</option>)}</select></div>
  </>}
  <MatrixHeatmap layout="readable-grid" groups={snapshot?tpexMatrixGroups(snapshot,participant,industry):[]} title={industry===null?'上柜法人行业矩阵':`${industryLabel(industry)} · 公司矩阵`} description={`${participantLabel} · ${snapshot?.report_date??'等待报告'} · ${industry===null?'点击行业下钻公司':'点击公司查看买进、卖出与净股数'}`} colorMeaning="净买卖超 ÷（买进股数 + 卖出股数），固定 −100% 至 +100%；正值净买入，负值净卖出。已报告零成交为中性，缺失为灰色。" areaMeaning={industry===null?'无可比较金额：来源只有股数，每个行业等面积。行业股数是已报告公司的简单加总。':'无可比较金额：来源只有股数，每家公司等面积。'} colorMaxAbs={1} onSelect={item=>{if(industry===null){setIndustry(item.id);setSelectedCode(null);}else setSelectedCode(item.id);}} emptyMessage="仅在两份官方报告的日期一致、代码唯一、股数平衡、公司行业连接通过验证后展示。报告超过 14 天或获取缓存超过 24 小时后停止展示。"/>
  {activeIndustry&&<p className={s.coverageNote}>{activeIndustry.label}：已报告 {activeIndustry.known}/{activeIndustry.rows.length} 家；{activeIndustry.missing} 家缺失。已报告净股数合计 {activeIndustry.totals?signed(activeIndustry.totals.net):'未知'} 股，非完整行业资金总额。</p>}
  {selected&&<section className={s.detailSection} aria-label="选中公司详情" aria-live="polite"><article className={s.card}><div className={s.cardTitle}><div><p>{selected.code} · {industryLabel(selected.industry_code)}</p><h3>{selected.name}</h3></div><span>{snapshot?.report_date}</span></div><p>{participantLabel}</p>{selected.flow?<><div className={s.value}>{signed(selected.flow[participant].net)}<small>股</small></div><dl className={s.stats}><div><dt>买进</dt><dd>{selected.flow[participant].buy.toLocaleString('zh-CN')} 股</dd></div><div><dt>卖出</dt><dd>{selected.flow[participant].sell.toLocaleString('zh-CN')} 股</dd></div><div><dt>买卖超</dt><dd>{signed(selected.flow[participant].net)} 股</dd></div></dl></>:<p>公司在官方行业名册中，但当天法人报告没有匹配记录。数值未知，不视为零。</p>}</article></section>}
  {activeIndustry&&<details className={s.table}><summary>完整公司明细（包括缺失与零）</summary><table><thead><tr><th>公司</th><th>买进（股）</th><th>卖出（股）</th><th>净买卖超（股）</th></tr></thead><tbody>{activeIndustry.rows.map(r=><tr key={r.code}><td><button onClick={()=>setSelectedCode(r.code)}>{r.code} {r.name}</button></td><td>{r.flow?.[participant].buy.toLocaleString('zh-CN')??'缺失'}</td><td>{r.flow?.[participant].sell.toLocaleString('zh-CN')??'缺失'}</td><td>{r.flow?signed(r.flow[participant].net):'缺失'}</td></tr>)}</tbody></table></details>}
  <section className={s.sources}><h2>来源与计算口径</h2><ul><li>三大法人合计 = 外资及陆资（不含外资自营商）+ 投信 + 自营商。外资自营商已经包含在自营商，不能重复相加。</li><li>公司代号与官方行业名册精确连接。未匹配的证券不推断行业；名册中缺少交易记录的公司保留为未知。</li><li>股份数量不能衡量不同股价公司的资金规模。行业净股数与颜色是本应用计算的局部汇总，不是官方行业金额，不代表全球资金流或买卖建议。</li><li>这不是 TWSE 上市股票数据。TWSE T86 的开放再利用许可未核实，未自动抓取或混入。</li><li>报告超过 4 天标记陈旧；这是本应用的保守阈值。两份报告日期不同则暂不发布新快照，保留仍有效的旧快照。</li></ul><p>资料来源：金融监督管理委员会证券期货局／证券柜台买卖中心（TPEx），{snapshot?.report_date.slice(0,4)??'官方'} 上柜股票三大法人买卖明细资讯与上柜公司基本资料。此开放资料依政府资料开放授权条款第 1 版释出，本应用作行业连接与汇总；来源不背书本应用。</p><div className={s.links}><a href={FLOW_DATASET} target="_blank" rel="noreferrer">官方法人资料及授权 ↗</a><a href={COMPANY_DATASET} target="_blank" rel="noreferrer">官方公司行业资料及授权 ↗</a><a href={INDUSTRY_REFERENCE} target="_blank" rel="noreferrer">官方产业代码表 ↗</a><a href={LICENSE} target="_blank" rel="noreferrer">政府资料开放授权条款 ↗</a></div></section>
 </main></div>;
}
