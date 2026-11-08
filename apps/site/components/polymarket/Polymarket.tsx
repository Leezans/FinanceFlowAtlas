'use client';
import React,{useMemo,useState} from 'react';
import OrganizedEvidence from '@/components/evidence/OrganizedEvidence';
import {projectPolymarketReport} from '@/lib/evidence/polymarket-projection';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {SOURCE_DOCS,HOT_SOURCE_DOCS,SOURCE_TERMS,MAX_MARKETS,MAX_PAGES,type PolymarketView} from '@/lib/polymarket/model';
import {categoryMatrix,filterMarkets,marketMatrix,marketItem,namedOutcome,formatProbability,type Metric} from './matrix';
import {useSnapshot} from './useSnapshot';
import s from './polymarket.module.css';
import OpenInterest from './OpenInterest';
const time=(value:string|null|undefined)=>value?value.replace('T',' ').replace('Z',' UTC'):'未提供';
export default function Polymarket(){
 const [view,setView]=useState<PolymarketView>('hot');
 const {snapshot:evidence,age,loading,error,refresh,coolingDown,denied,stale,validateDownload}=useSnapshot(view);
 const interest=evidence?.schema==='polymarket-open-interest/1'||evidence?.schema==='polymarket-open-interest/2'?evidence:null;
 const snapshot=evidence?.schema==='polymarket-open-interest/1'||evidence?.schema==='polymarket-open-interest/2'?null:evidence;
 const organized=useMemo(()=>projectPolymarketReport(snapshot,stale),[snapshot,stale]);
 type Controls={query:string;category:string|null;metric:Metric;grouped:boolean};
 const [controls,setControls]=useState<Record<PolymarketView,Controls>>({hot:{query:'',category:null,metric:'probability',grouped:false},newest:{query:'',category:null,metric:'probability',grouped:false},interest:{query:'',category:null,metric:'probability',grouped:false}});
 const {query,category,metric,grouped}=controls[view];
 const change=(patch:Partial<Controls>)=>setControls(previous=>({...previous,[view]:{...previous[view],...patch}}));
 const setQuery=(query:string)=>change({query}),setCategory=(category:string|null)=>change({category}),setMetric=(metric:Metric)=>change({metric});
 const keyset=snapshot?.schema==='polymarket-gamma/2'?snapshot:null;
 const hot=snapshot?.schema==='polymarket-gamma/hot/1'?snapshot:null;
 const waitingForCooldown=!evidence&&!loading&&coolingDown&&!denied&&(!error||error==='cooldown');
 const rows=filterMarkets(snapshot?.rows??[],query),showGroups=grouped&&category===null;
 const groups=showGroups?categoryMatrix(rows):category!==null?marketMatrix(rows,category,metric):rows.length?[{id:'markets',label:view==='hot'?'热门市场问题':'较新 ID 市场问题',items:rows.map(row=>marketItem(row,metric))}]:[];
 const displayed=category===null?rows:rows.filter(row=>`${row.category_basis}:${row.category}`===category);
 const availablePrices=displayed.filter(row=>namedOutcome(row).price!==null).length;
 const missingVolumes=displayed.filter(row=>row.volume_24h===null).length,zeroVolumes=displayed.filter(row=>row.volume_24h===0).length;
 return <main className={s.root}>
  <header className={s.header}><a href="/markets">Finance Flow Atlas</a><a href="/crypto">加密现货矩阵</a></header>
  <section className={s.intro}><p>POLYMARKET / PUBLIC DATA</p><h1>预测市场热力矩阵</h1><p>直接查看热门市场问题，或切换较新 ID 样本；也可按分组浏览。页面可见时，普通模式每 30 秒检查公开数据，持仓金额模式每 5 分钟检查。来源观测时间未知，不保证实时行情。</p><p className={s.notice}>价格隐含概率不等于客观真实概率。成交量不等于资金净流入。本页不提供投资建议、下单、钱包连接或账户功能。</p></section>
  <div className={s.modeSwitch} role="group" aria-label="市场发现模式"><button aria-pressed={view==='hot'} onClick={()=>setView('hot')}>热门 · 24 小时成交量</button><button aria-pressed={view==='newest'} onClick={()=>setView('newest')}>较新 · 市场 ID</button><button aria-pressed={view==='interest'} onClick={()=>setView('interest')}>金额 · 未平仓持仓</button></div>
  <section className={s.status} aria-label="数据获取状态" aria-live="polite"><div><strong>{error==='permission'?'展示权限已失效':denied?'来源访问已停止':evidence?stale?'上次有效快照 · 已陈旧':'已获取来源快照':loading?'正在获取公开数据':waitingForCooldown?'等待共享来源冷却':'暂无可验证数据'}</strong><p>{error==='permission'?'已清空数据并停止检查，请恢复访问权限。':denied?'来源拒绝访问；停止自动重试，不更换访问路径。':error==='gate'?'来源访问状态尚未确认，暂不展示数据。':error==='invalid'?'响应数据未通过校验，已清空当前模式数据。':error==='cooldown'||waitingForCooldown?'等待共享来源冷却结束后检查当前模式；切换模式不会额外请求来源。':error==='network'?`本次检查失败，仅保留未超过 ${view==='interest'?10:5} 分钟的有效快照。`:view==='interest'?'超过 5 分钟标记陈旧，超过 10 分钟停止展示；不会填入模拟数据。':'超过 30 秒标记陈旧，超过 5 分钟停止展示；不会填入模拟数据。'}</p></div><button onClick={()=>void refresh()} disabled={loading||coolingDown||denied||error==='permission'}>{loading?'正在检查…':'检查更新'}</button></section>
  <div className={s.times}><span>成功获取时间：{time(evidence?.fetched_at)}</span><span>快照年龄{interest?.schema==='polymarket-open-interest/2'?'（自首批 OI 请求起）':interest?'（旧版自响应接收起）':''}：{age===null?'无可展示快照':`${Math.floor(age/1000)} 秒`}</span><span>{view==='interest'?'持仓估值时间':'价格观测时间'}：接口未提供 · 延迟未知</span></div>
  {view==='interest'?<OpenInterest snapshot={interest}/>:<>
  <section className={s.sources} aria-label="样本覆盖范围"><p>{view==='hot'?'热门范围：来源按 24 小时成交量倒序返回最多 100 条记录，单页采集后筛选活跃且未关闭的市场；不是全站完整榜单。':`较新范围：按市场 ID 倒序稳定分页，最多 ${MAX_PAGES} 页、${MAX_MARKETS} 条来源记录，再筛选活跃且未关闭的市场。ID 仅是新旧代理，不是实际创建时间排序。`} 全站市场总数未知。</p>{snapshot&&<><p>{hot?`本次读取 1 页（${hot.source_page_sizes[0]} 条）。`:keyset?`本次读取 ${keyset.source_page_count} 页（每页 ${keyset.source_page_sizes.join(' / ')} 条）。`:'当前显示上一版单页样本：按来源 24 小时成交量排序，最多 200 个市场。新分页采集尚未成功；旧样本不提供后续游标信息。'}返回 {snapshot.source_market_count} {keyset?'个不同市场':'条来源记录'}，展示 {snapshot.rows.length} 个，排除 {snapshot.excluded_market_count} 个。样本展示分组 {categoryMatrix(snapshot.rows)[0].items.length} 个；当前搜索匹配 {rows.length} 个市场。</p>{hot&&<p>{hot.stop_reason==='sample_limit'?'已到单页 100 条样本上限。':'来源返回少于 100 条记录。'} 后续范围未知，不能据此判断全站完整性。</p>}{keyset&&<p>{keyset.stop_reason==='page_limit'?'已到本次页数上限，来源仍有后续页。':keyset.stop_reason==='time_budget'?'已到本次采集时间预算，来源仍有后续页。':'来源本次未返回后续游标；这不是全站完整性的保证。'} 分页采集不代表同一时刻的全市场快照。</p>}<p>本次采集：{time(snapshot.acquisition_started_at)} 至 {time(snapshot.fetched_at)}</p></>}</section>
  <div className={s.controls}><label>搜索市场<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="完整问题、分类或结果"/></label><label>市场指标<select value={metric} onChange={e=>setMetric(e.target.value as Metric)}><option value="probability">指定结果的价格隐含概率</option><option value="volume">平台报告的 24 小时成交量</option></select></label><button aria-pressed={grouped} onClick={()=>change({grouped:!grouped,category:null})}>{grouped?'直接查看市场':'按分组浏览'}</button>{category!==null&&<button onClick={()=>setCategory(null)}>返回全部分组</button>}</div>
  {snapshot&&<p className={s.availability} aria-label="当前筛选字段可用性">当前筛选 {displayed.length} 个市场：指定结果价格可用 {availablePrices} 个、缺失 {displayed.length-availablePrices} 个；24 小时成交量缺失 {missingVolumes} 个、零 {zeroVolumes} 个、正值 {displayed.length-missingVolumes-zeroVolumes} 个。缺失不等于零。</p>}
  <MatrixHeatmap groups={groups} title={showGroups?'样本分组矩阵':'市场问题矩阵'} description={showGroups?'每个市场只归入一个展示分组；数字仅统计当前样本，不是官方分类总数。点击下钻查看市场指标。':'所有问题完整展示，不截断名称。筛选与指标在更新时保持不变。'} layout="readable-grid" colorMode="sequential" colorMaxAbs={!showGroups&&metric==='probability'?1:undefined} colorMeaning={showGroups?'匹配市场数量':metric==='probability'?'所标明结果的价格隐含概率，0%–100%':'平台报告的 24 小时成交量，当前可见市场内相对着色'} areaMeaning="等面积；不代表交易额或资金规模" emptyTitle="矩阵暂无可核验数据" emptyMessage={snapshot?'当前搜索或分类没有匹配市场；可修改搜索或返回全部分组。':'等待来源返回通过校验且未过期的数据。'} emptyNote="缺失不是零，不使用示例数据。" onSelect={showGroups?item=>setCategory(item.id):undefined}/>
  <OrganizedEvidence report={organized} onDownload={event=>{if(!snapshot||!validateDownload(snapshot,stale))event.preventDefault();}}/>
  {!showGroups&&snapshot&&<details className={s.sources}><summary>市场结果与来源记录更新时间</summary>{displayed.map(row=><section key={row.id}><h3>{row.question}</h3><p>{row.outcomes.map(o=>`${o.name}：${formatProbability(o.price)}`).join('；')}</p><p>来源标签：{row.tags.map(tag=>tag.label).join('、')||'未提供'}</p><p>来源记录更新时间：{time(row.source_record_updated_at)}（不是价格观测时间）</p></section>)}</details>}
  <section className={s.sources}><h2>指标与使用边界</h2><ul><li>二元 Yes / No 市场明确使用 Yes 对应价格；其他市场使用来源列出的第一个结果，并在区块中标明结果名称。不同问题的概率不相加、不平均。</li><li>24 小时成交量保留来源数值，单位尚未核实，不标为美元，不计算分类合计。零为来源报告的零，灰色表示来源未提供。</li><li>{snapshot?.schema==='polymarket-gamma/1'?'上一版样本的展示分组使用来源分类，否则使用来源首个标签。':'展示分组优先使用来源分类；没有分类时，选取标签 slug 按字符排序最前的一项，避免来源标签顺序变化导致分组漂移。'}这不是官方主分类或完整标签体系。所有来源标签均保留并可搜索；缺失时标为未分类。</li><li>仅供个人信息参考，保持现有私人访问边界。公开接口和代码开源不代表取得商业使用或再分发许可。</li></ul><p><a href={view==='hot'?HOT_SOURCE_DOCS:SOURCE_DOCS} target="_blank" rel="noreferrer">官方字段说明 ↗</a> · <a href={SOURCE_TERMS} target="_blank" rel="noreferrer">Polymarket 使用条款 ↗</a></p></section>
 </>}
 </main>;
}
