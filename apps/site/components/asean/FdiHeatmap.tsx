'use client';
import React from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {HOSTS,SECTORS} from '@/lib/asean/dimensions';
import type {FdiCell} from '@/lib/asean/model';
import {cellText,cellExplanation,colorKey,valueText,fdiMonetaryGroups} from './matrix';
import s from './asean.module.css';
export default function FdiHeatmap({cells,year,maximum,host,onSelect}:{cells:FdiCell[];year:number;maximum:number;host:string;onSelect:(cell:FdiCell)=>void}){
 const countries=HOSTS.filter(h=>!host||h.code===host),lookup=new Map(cells.map(c=>[`${c.sector}/${c.host}`,c]));
 const amountGroups=fdiMonetaryGroups(cells,year,host);
 const fullTable=<>
 {cells.length?<><p className={s.scrollHint}>{countries.length>1?'横向滑动查看全部国家。':'当前为单一接收国，保留全部行业。'}点击或用 Tab / Enter 选择格子查看原始值与说明。</p><div className={s.scroll} tabIndex={0} role="region" aria-label="可横向滚动的国家行业矩阵"><table className={s.heatmap} data-single-country={countries.length===1?'true':undefined}><caption>{year} 年净流入 FDI，百万美元。行业为行，投资接收国为列。</caption><thead><tr><th scope="col">经济行业</th>{countries.map(h=><th scope="col" key={h.code}>{h.label}<small>{h.code}</small></th>)}</tr></thead><tbody>{SECTORS.map(sector=><tr key={sector.code}><th scope="row"><b>{sector.code}</b>{sector.label}</th>{countries.map(country=>{const cell=lookup.get(`${sector.code}/${country.code}`);return <td key={country.code}>{cell&&<button data-quality={cell.state} data-color={colorKey(cell,maximum)} onClick={()=>onSelect(cell)} aria-label={`${year} · ${country.label} · ${sector.label} · ${cellText(cell)}${cell.state==='reported'?' 百万美元':''} · ${cellExplanation(cell)}`} title={`${country.source} / ${sector.source}: ${cellText(cell)}`}><span>{cellText(cell)}</span></button>}</td>;})}</tr>)}</tbody></table></div></>:<div className={s.empty} role="status"><h3>行业矩阵已保留，等待可验证的官方数据</h3><p>不会把持仓、价格、n.a 或重复来源记录填成资金流数值。</p></div>}</>;
 return <section className={s.matrix} aria-label="东盟国家 × 行业 FDI 热力矩阵">
  <div className={s.matrixHeading}><div><p className={s.eyebrow}>ANNUAL / NET INWARD FDI</p><h2>{year} · 国家 × 经济行业</h2></div><span>百万美元 · 年度流量</span></div>
  <p className={s.meaning}>各国行业覆盖与统计范围不同，不跨国家混排或汇总面积。选择接收国后，按该国同年度具体行业金额绝对值分配面积；完整坐标表保留全部原始状态。所有国家颜色共用当年线性量尺，范围 ±{valueText(maximum).replace(/^\+/, '')} 百万美元；切换国家不改量尺。</p>
  {host&&cells.length>0?<>
   <MatrixHeatmap groups={amountGroups} title={`${countries[0]?.label??host} · 行业金额矩阵`} layout="treemap" scopeKey={`asean:${host}:${year}`} colorMaxAbs={maximum}
    description={host==='PH'?'菲律宾具体行业仅含净股权资本，不包含债务与再投资收益。':host==='SG'?'新加坡 M 包含 N，因此 N 不再纳入金额矩阵。':'同一接收国、同一年度的具体行业净流入 FDI。'}
    areaMeaning="同国同年已报告行业净额绝对值（USD）；百万美元统一换算，不计零值、缺失或重复记录。Z 未指定行业不参与面积。"
    colorMeaning="红正绿负，零中性；缺失与重复隔离不着色。面积之和不是净流入总额。"
    onSelect={item=>{const cell=lookup.get(`${item.id}/${host}`);if(cell)onSelect(cell);}}/>
   <details><summary>完整国家行业坐标表 · 含未指定行业与隔离记录</summary>{fullTable}</details>
  </>:<><p className={s.scrollHint}>选择一个接收国，查看可滚轮缩放的行业金额矩阵。</p>{fullTable}</>}
 </section>;
}
