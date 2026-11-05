'use client';
import React from 'react';
import {HOSTS,SECTORS} from '@/lib/asean/dimensions';
import type {FdiCell} from '@/lib/asean/model';
import {cellText,cellExplanation,colorKey,valueText} from './matrix';
import s from './asean.module.css';
export default function FdiHeatmap({cells,year,maximum,host,onSelect}:{cells:FdiCell[];year:number;maximum:number;host:string;onSelect:(cell:FdiCell)=>void}){
 const countries=HOSTS.filter(h=>!host||h.code===host),lookup=new Map(cells.map(c=>[`${c.sector}/${c.host}`,c]));
 return <section className={s.matrix} aria-label="东盟国家 × 行业 FDI 热力矩阵"><div className={s.matrixHeading}><div><p className={s.eyebrow}>ANNUAL / NET INWARD FDI</p><h2>{year} · 国家 × 经济行业</h2></div><span>百万美元 · 年度流量</span></div>
 <p className={s.meaning}>每格等面积。颜色是年度净流入金额：红色为正、绿色为负，零为中性；灰色未知，斜纹为重复记录隔离。所有国家共用当年线性量尺，范围 ±{valueText(maximum).replace(/^\+/,'')} 百万美元；切换国家不改量尺。</p>
 {cells.length?<><p className={s.scrollHint}>横向滑动查看全部国家。点击或用 Tab / Enter 选择格子查看原始值与说明。</p><div className={s.scroll} tabIndex={0} role="region" aria-label="可横向滚动的国家行业矩阵"><table className={s.heatmap}><caption>{year} 年净流入 FDI，百万美元。行业为行，投资接收国为列。</caption><thead><tr><th scope="col">经济行业</th>{countries.map(h=><th scope="col" key={h.code}>{h.label}<small>{h.code}</small></th>)}</tr></thead><tbody>{SECTORS.map(sector=><tr key={sector.code}><th scope="row"><b>{sector.code}</b>{sector.label}</th>{countries.map(country=>{const cell=lookup.get(`${sector.code}/${country.code}`);return <td key={country.code}>{cell&&<button data-quality={cell.state} data-color={colorKey(cell,maximum)} onClick={()=>onSelect(cell)} aria-label={`${year} · ${country.label} · ${sector.label} · ${cellText(cell)}${cell.state==='reported'?' 百万美元':''} · ${cellExplanation(cell)}`} title={`${country.source} / ${sector.source}: ${cellText(cell)}`}><span>{cellText(cell)}</span></button>}</td>;})}</tr>)}</tbody></table></div></>:<div className={s.empty} role="status"><h3>行业矩阵已保留，等待可验证的官方数据</h3><p>不会把持仓、价格、n.a 或重复来源记录填成资金流数值。</p></div>}
 </section>;
}
