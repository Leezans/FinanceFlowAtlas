'use client';
import React,{useState} from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {SOURCE_DOCS,SOURCE_TERMS} from '@/lib/polymarket/model';
import {categoryMatrix,filterMarkets,marketMatrix,type Metric} from './matrix';
import {useSnapshot} from './useSnapshot';
import s from './polymarket.module.css';
const time=(value:string|null|undefined)=>value?value.replace('T',' ').replace('Z',' UTC'):'未提供';
export default function Polymarket(){
 const {snapshot,age,loading,error,refresh,coolingDown,denied,stale}=useSnapshot();
 const [query,setQuery]=useState(''),[category,setCategory]=useState<string|null>(null),[metric,setMetric]=useState<Metric>('probability');
 const rows=filterMarkets(snapshot?.rows??[],query),groups=category===null?categoryMatrix(rows):marketMatrix(rows,category,metric);
 return <main className={s.root}>
  <header className={s.header}><a href="/markets">Finance Flow Atlas</a><a href="/crypto">加密现货矩阵</a></header>
  <section className={s.intro}><p>POLYMARKET / GAMMA</p><h1>预测市场热力矩阵</h1><p>查看来源分类，再下钻到完整市场问题。页面可见时每 30 秒检查公开数据；价格观测时间未知，不保证实时行情。</p><p className={s.notice}>价格隐含概率不等于客观真实概率。成交量不等于资金净流入。本页不提供投资建议、下单、钱包连接或账户功能。</p></section>
  <section className={s.status} aria-label="数据获取状态" aria-live="polite"><div><strong>{error==='permission'?'展示权限已失效':denied?'来源访问已停止':snapshot?stale?'上次有效快照 · 已陈旧':'已获取来源快照':loading?'正在获取公开数据':'暂无可验证数据'}</strong><p>{error==='permission'?'已清空数据并停止检查，请恢复访问权限。':denied?'来源拒绝访问；停止自动重试，不更换访问路径。':error==='gate'?'来源访问状态尚未确认，暂不展示数据。':error==='invalid'?'响应数据未通过校验，已清空浏览器数据。':error==='network'?'本次检查失败，仅保留未超过 5 分钟的有效快照。':'超过 30 秒标记陈旧，超过 5 分钟停止展示；不会填入模拟数据。'}</p></div><button onClick={()=>void refresh()} disabled={loading||coolingDown||denied||error==='permission'}>{loading?'正在检查…':'检查更新'}</button></section>
  <div className={s.times}><span>成功获取时间：{time(snapshot?.fetched_at)}</span><span>快照年龄：{age===null?'无可展示快照':`${Math.floor(age/1000)} 秒`}</span><span>价格观测时间：接口未提供 · 延迟未知</span></div>
  <p>范围：按来源 24 小时成交量排序，最多 200 个活跃市场的有界样本，不代表完整市场。{snapshot&&`本次返回 ${snapshot.source_market_count} 个，展示 ${snapshot.rows.length} 个，排除 ${snapshot.excluded_market_count} 个。`}</p>
  <div className={s.controls}><label>搜索市场<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="完整问题、分类或结果"/></label><label>市场指标<select value={metric} onChange={e=>setMetric(e.target.value as Metric)}><option value="probability">指定结果的价格隐含概率</option><option value="volume">平台报告的 24 小时成交量</option></select></label>{category!==null&&<button onClick={()=>setCategory(null)}>返回全部分类</button>}</div>
  <MatrixHeatmap groups={groups} title={category===null?'来源分类矩阵':'市场问题矩阵'} description={category===null?'分类区块展示匹配的市场数量；点击下钻，查看所选市场指标。':'所有问题完整展示，不截断名称。筛选与指标在更新时保持不变。'} layout="readable-grid" colorMode="sequential" colorMaxAbs={category!==null&&metric==='probability'?1:undefined} colorMeaning={category===null?'匹配市场数量':metric==='probability'?'所标明结果的价格隐含概率，0%–100%':'平台报告的 24 小时成交量，当前可见市场内相对着色'} areaMeaning="等面积；不代表交易额或资金规模" emptyTitle="矩阵暂无可核验数据" emptyMessage={snapshot?'当前搜索或分类没有匹配市场；可修改搜索或返回全部分类。':'等待来源返回通过校验且未过期的数据。'} emptyNote="缺失不是零，不使用示例数据。" onSelect={category===null?item=>setCategory(item.id):undefined}/>
  {category!==null&&snapshot&&<details className={s.sources}><summary>市场结果与来源记录更新时间</summary>{rows.filter(r=>`${r.category_basis}:${r.category}`===category).map(row=><section key={row.id}><h3>{row.question}</h3><p>{row.outcomes.map(o=>`${o.name}：${o.price===null?'来源未提供':`${(Number(o.price)*100).toLocaleString('zh-CN',{maximumFractionDigits:4})}%`}`).join('；')}</p><p>来源记录更新时间：{time(row.source_record_updated_at)}（不是价格观测时间）</p></section>)}</details>}
  <section className={s.sources}><h2>指标与使用边界</h2><ul><li>二元 Yes / No 市场明确使用 Yes 对应价格；其他市场使用来源列出的第一个结果，并在区块中标明结果名称。不同问题的概率不相加、不平均。</li><li>24 小时成交量保留来源数值，单位尚未核实，不标为美元，不计算分类合计。零为来源报告的零，灰色表示来源未提供。</li><li>分类仅使用来源分类或来源标签；缺失时标为未分类，不按问题内容猜测分组。分类数量只统计当前样本。</li><li>仅供个人信息参考，保持现有私人访问边界。公开接口和代码开源不代表取得商业使用或再分发许可。</li></ul><p><a href={SOURCE_DOCS} target="_blank" rel="noreferrer">官方字段说明 ↗</a> · <a href={SOURCE_TERMS} target="_blank" rel="noreferrer">Polymarket 使用条款 ↗</a></p></section>
 </main>;
}
