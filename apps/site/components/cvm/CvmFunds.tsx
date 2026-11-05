'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {REFRESH_MS,STALE_REPORT_DAYS,replySchema,visibleSnapshot,reportAge,type CvmReply} from '@/lib/cvm/model';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {industries,industryLabel,money,signedMoney,cvmMatrixGroups} from './matrix';
import s from './cvm.module.css';
const stamp=(t:string|null)=>t?t.replace('T',' ').replace('Z',' UTC'):'未提供';
export default function CvmFunds({embedded=false}:{embedded?:boolean}={}){
 const [data,setData]=useState<CvmReply|null>(null),[loading,setLoading]=useState(false),[failure,setFailure]=useState<'network'|'permission'|'invalid'|null>(null),[now,setNow]=useState(0),[industry,setIndustry]=useState<string|null>(null),[selectedCode,setSelectedCode]=useState<string|null>(null);
 const active=useRef<AbortController|null>(null),mounted=useRef(false),blocked=useRef(false);
 const refresh=useCallback(async()=>{
  if(active.current||blocked.current)return;
  const controller=new AbortController();active.current=controller;setLoading(true);
  const timeout=setTimeout(()=>controller.abort(),65_000);
  try{
   const response=await fetch('/api/v1/brazil/cvm/snapshot',{credentials:'same-origin',cache:'no-store',redirect:'manual',signal:controller.signal});
   if([401,403].includes(response.status)||response.type==='opaqueredirect'||response.redirected||response.status>=300&&response.status<400){if(mounted.current&&active.current===controller){blocked.current=true;setData(null);setFailure('permission');}return;}
   let result:CvmReply;
   try{result=replySchema.parse(await response.json());if(![200,503].includes(response.status))throw new Error('invalid_response');}
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
 const groups=snapshot?industries(snapshot):[],group=groups.find(g=>g.industry===industry)??null;
 const selected=snapshot?.rows.find(r=>r.code===selectedCode&&r.industry===industry)??null;
 const known=snapshot?.rows.filter(r=>r.flow!==null).length??0;
 const Container=embedded?'section':'main';
 return <div className={`${s.surface} ${embedded?s.embedded:''}`}><Container className={s.root}>
  {!embedded&&<header className={s.header}><a href="/markets">◉ Finance Flow Atlas</a><a href="/taiwan">台股法人矩阵 ↗</a></header>}
  <section className={s.intro}><p className={s.eyebrow}>BRAZIL / CVM OPEN DATA</p>{embedded?<h3>巴西基金 · 股票行业矩阵</h3>:<h1>巴西基金 · 股票行业矩阵</h1>}<p className={s.subtitle}>行业 → 证券下钻 · 月度实际买卖金额 · ODbL 开放数据，无需账户</p><p className={s.notice}>这里只汇总 CVM 公开披露的投资基金股票交易，金额为巴西雷亚尔（BRL）。不是全部机构、外资或全市场资金流；未披露和保密交易不分摊至行业。不用持仓差或股价推算流量。</p></section>
  <section className={s.status} aria-live="polite"><div><strong>{failure==='permission'?'展示权限已失效':denied?'来源访问已停止':loading&&!snapshot?'正在读取 CVM 官方月报':snapshot?stale?'保留已校验月报 · 请注意陈旧状态':'已取得可校验的月度交易报告':'暂无可验证的基金股票月报'}</strong><p>{failure==='permission'?'已清空证据并停止检查。':failure==='invalid'?'响应未通过校验，已清空证据。':denied?'来源拒绝访问后停止请求，不切换路径。':failure==='network'?'连接失败，只保留仍在展示期限内的已校验报告。':'每日检查一次；选择当前月前两个月，避开刚开始申报的月份。仍可能存在保密、迟报与修订。首次获取可能需要一分钟。'}</p>{data?.status.error_code&&<small>{data.status.error_code}</small>}</div><button onClick={()=>void refresh()} disabled={loading||denied||failure==='permission'}>{loading?'正在检查…':'检查月报'}</button></section>
  <div className={s.times}><span>交易观测月<b>{snapshot?.period??'暂无报告'}</b></span><span>分类快照获取日<b>{snapshot?.classification_date??'暂无分类'}</b></span><span>来源实际发布时间<b>未提供，不以获取时间代替</b></span><span>最近成功获取<b>{stamp(snapshot?.fetched_at??data?.status.fetched_at??null)}</b></span></div>
  {snapshot&&<>
   <div className={s.coverage}><span><b>{known} / {snapshot.rows.length}</b> 只证券有有效公开交易记录</span><span><b>{groups.length}</b> 个官方行业</span><span><b>{snapshot.counts.public_funds}</b> 个公开报告基金 / 类别</span><span><b>{snapshot.counts.confidential_rows}</b> 条股票保密汇总，未分配</span></div>
   <p className={s.coverageNote}>未匹配交易记录 {snapshot.counts.unmatched_rows} 条；歧义 {snapshot.counts.ambiguous_rows} 条；金额缺失 {snapshot.counts.null_amount_rows} 条；重复 {snapshot.counts.duplicate_rows} 条。缺失不视为零。公开披露的覆盖范围随月份和保密期限变化。</p>
   <div className={s.filter}><button disabled={industry===null} onClick={()=>{setIndustry(null);setSelectedCode(null);}}>← 全部行业</button><label htmlFor="cvm-industry">行业</label><select id="cvm-industry" value={industry??''} onChange={e=>{setIndustry(e.target.value||null);setSelectedCode(null);}}><option value="">全部行业</option>{groups.map(g=><option key={g.industry} value={g.industry}>{industryLabel(g.industry)} · {g.known}/{g.rows.length}</option>)}</select></div>
  </>}
  <MatrixHeatmap layout="treemap" groups={snapshot?cvmMatrixGroups(snapshot,industry):[]} title={industry===null?'基金股票 · 行业净买卖矩阵':`${industryLabel(industry)} · 证券矩阵`} description={`${snapshot?.period??'等待月报'} · ${industry===null?'选行业下钻证券':'选证券查看买入、卖出和净额'} · BRL`} colorMeaning="净买卖金额 ÷（买入 + 卖出），固定 −100% 至 +100%；正值净买入，负值净卖出。零交易中性，未知灰色。" areaMeaning={industry===null?'行业面积为已报告证券净额绝对值之和（BRL），不以正负抵消；数字与颜色仍为行业净额。':'证券面积按同月净买卖金额绝对值（BRL）；仅公开有效记录，不是市值。'} colorMaxAbs={1} onSelect={item=>{if(industry===null){setIndustry(item.id);setSelectedCode(null);}else setSelectedCode(item.id);}} emptyMessage="只有官方 ZIP、股票交易类别、精确公司代码与行业连接均通过校验才显示。绝不从持仓估计买卖。报告超过 180 天或获取缓存超过 7 天后隐藏。"/>
  {group&&<p className={s.coverageNote}>{group.industry}：{group.known}/{group.rows.length} 只证券有有效公开交易记录。可用部分净买卖合计 {group.totals?signedMoney(group.totals.net):'未知'}。不代表完整行业总额。</p>}
  {selected&&<section className={s.card} aria-label="选中证券详情" aria-live="polite"><p>{selected.code} · {selected.industry}</p><h2>{selected.name}</h2><p>{snapshot?.period} · {selected.source_rows} 条公开披露交易记录</p>{selected.flow?<><div className={s.value}>{signedMoney(selected.flow.net)}</div><dl className={s.stats}><div><dt>买入金额</dt><dd>{money(selected.flow.buy)}</dd></div><div><dt>卖出金额</dt><dd>{money(selected.flow.sell)}</dd></div><div><dt>净买卖金额</dt><dd>{signedMoney(selected.flow.net)}</dd></div></dl></>:<p>没有完整可用的公开交易金额，不能把未知解释为零。保密交易不会被分配到该证券。</p>}</section>}
  {group&&<details className={s.table}><summary>完整证券明细（包括未知与零）</summary><table><thead><tr><th>证券</th><th>买入（BRL）</th><th>卖出（BRL）</th><th>净额（BRL）</th></tr></thead><tbody>{group.rows.map(r=><tr key={r.code}><td><button onClick={()=>setSelectedCode(r.code)}>{r.code} {r.name}</button></td><td>{r.flow?money(r.flow.buy):'未知'}</td><td>{r.flow?money(r.flow.sell):'未知'}</td><td>{r.flow?signedMoney(r.flow.net):'未知'}</td></tr>)}</tbody></table></details>}
  <section className={s.sources}><h2>来源、许可与局限</h2><ul><li>数据来源：巴西证券监管机构 Comissão de Valores Mobiliários（CVM）。CDA 股票类别的月内买入金额减去卖出金额；不使用月末持仓变化。</li><li>只纳入已核实的基金 / 类别、普通股和优先股公开明细。衍生品、证券借贷、债券、其他基金份额和未编码资产不混入。</li><li>证券代码与 FCA 同一份公司申报中的行业精确连接。不猜测代码别名、不按公司名称推断行业。行业使用来源葡萄牙文名称，保留控股公司分类。</li><li>分类来自获取时可用的 FCA 版本，不是历史时点的分类。最新申报和公司改名可能使旧代码无法匹配。未匹配记录排除并报告数量。</li><li>保密记录仅能识别基金和股票类别，不能识别行业。公开基金间的买卖可能互相抵消；本图不是流入公司或市场的新增现金，也不能据此判断投资回报。</li><li>月报可能修订，基金覆盖数量不能跨月直接视为完整性提升。超过 100 天标记陈旧；获取缓存超过 7 天或报告超过 180 天隐藏。</li></ul><p>本应用对 CVM 开放数据做筛选、精确连接和汇总；来源不背书本应用。派生数据库依 Open Data Commons Open Database License（ODbL）提供，原始数据与计算口径均可追溯。应用代码许可不改变源数据库许可。</p><div className={s.links}><a href="https://dados.cvm.gov.br/dataset/fi-doc-cda" target="_blank" rel="noreferrer">CDA 官方数据与授权 ↗</a><a href="https://dados.cvm.gov.br/dataset/cia_aberta-doc-fca" target="_blank" rel="noreferrer">FCA 公司与行业 ↗</a><a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL 1.0 许可 ↗</a><a href="/api/v1/brazil/cvm/snapshot" target="_blank" rel="noreferrer">派生数据库 JSON ↗</a></div></section>
 </Container></div>;
}
