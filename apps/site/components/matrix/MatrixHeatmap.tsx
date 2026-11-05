'use client';
import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {hierarchy,treemap,treemapSquarify} from 'd3-hierarchy';
import {matrixEntries,matrixColorMaximum,matrixColor,matrixWeight,describeMatrixItem,readableGridColumns,type MatrixItem,type MatrixGroup,type MatrixColorMode} from '@/lib/matrix/model';
import s from './matrix.module.css';

// Compatibility exports for existing consumers; new projections import the pure model.
export type {MatrixItem,MatrixGroup} from '@/lib/matrix/model';
export {readableGridColumns} from '@/lib/matrix/model';

export type MatrixHeatmapProps={groups:MatrixGroup[];title:string;description?:string;colorMeaning:string;areaMeaning:string;colorMode?:MatrixColorMode;colorMaxAbs?:number;layout?:'treemap'|'readable-grid';emptyTitle?:string;emptyMessage?:string;emptyNote?:string;onSelect?:(item:MatrixItem,group:MatrixGroup)=>void};
type Node={id:string;label:string;item?:MatrixItem;group?:MatrixGroup;children?:Node[]};
/** Presentation only. No observations, classification inference, source requests, or monetary conversion. */
export default function MatrixHeatmap({groups,title,description,colorMeaning,areaMeaning,colorMode='signed',colorMaxAbs,layout:layoutMode='treemap',emptyTitle='矩阵暂无可核验数据',emptyNote='不以价格、持仓或模拟数值填充资金流。',emptyMessage='尚无通过核验的数据。缺失不是零，矩阵不会用示例数值填满。',onSelect}:MatrixHeatmapProps){
 const host=useRef<HTMLDivElement>(null),prefix=useId().replace(/:/g,'');
 const [width,setWidth]=useState(1100),[inspected,setInspected]=useState<string|null>(null);
 useEffect(()=>{if(!host.current)return;const measure=()=>{const next=host.current?.clientWidth;if(next&&next>0)setWidth(Math.round(next))};measure();if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(measure);observer.observe(host.current);return()=>observer.disconnect()},[]);
 useEffect(()=>{if(layoutMode==='readable-grid'&&host.current)host.current.scrollTop=0;},[layoutMode,title]);
 const height=width<600?440:520;
 const populated=useMemo(()=>groups.filter(group=>group.items.length>0),[groups]);
 const entries=useMemo(()=>matrixEntries(populated),[populated]);
 const layout=useMemo(()=>layoutMode==='readable-grid'?null:treemap<Node>().tile(treemapSquarify).size([width,height]).paddingOuter(3).paddingInner(3).paddingTop(node=>node.depth===1?28:0).round(true)(hierarchy<Node>({id:'root',label:title,children:populated.map(group=>({id:group.id,label:group.label,group,children:group.items.map(item=>({id:`${group.id}/${item.id}`,label:item.label,item,group}))}))}).sum(node=>node.item?matrixWeight(node.item):0)),[populated,width,height,title,layoutMode]);
 const leaves=layout?.leaves().filter(node=>node.data.item)??[],maximum=matrixColorMaximum(entries,colorMaxAbs);
 const inspectedEntry=entries.find(entry=>entry.id===inspected),active=inspectedEntry?.item;
 const color=(item:MatrixItem)=>matrixColor(item,colorMode,maximum);
 const describe=describeMatrixItem;
 return <section className={s.root} aria-label={title}>
  <header className={s.heading}><div><p className={s.eyebrow}>MATRIX VIEW</p><h2>{title}</h2>{description&&<p>{description}</p>}</div><span className={s.viewLabel}>矩形热力矩阵</span></header>
  <div className={s.meanings}><span>面积：{areaMeaning}</span><span>颜色：{colorMeaning}</span></div>
  {layoutMode==='readable-grid'&&entries.length>0&&<p className={s.gridHint}>全部 {entries.length} 个区块 · 在矩阵内滚动查看，或按 Tab 逐项选择</p>}
  <div ref={host} className={s.canvas} data-layout={layoutMode} data-matrix-empty={entries.length===0?'true':undefined}>
   {entries.length?layoutMode==='readable-grid'?<div role="group" aria-label={`${title}区块`} className={s.readableGroups}>
    {populated.map(group=><section key={group.id} className={s.gridGroup} aria-label={group.label}><h3>{group.label}</h3><div className={s.readableGrid} style={{gridTemplateColumns:`repeat(${readableGridColumns(width)}, minmax(0, 1fr))`}}>
     {group.items.map(item=>{const id=`${group.id}/${item.id}`;const content=<><span data-matrix-label className={s.gridName}>{item.label}</span><span className={s.gridValue}>{item.displayValue}</span>{item.detail&&<span className={s.gridDetail}>{item.detail}</span>}</>;const shared={className:s.gridTile,'data-id':item.id,'data-color':color(item),'aria-label':describe(item,group),title:describe(item,group),onMouseEnter:()=>setInspected(id),onMouseLeave:()=>setInspected(null),onFocus:()=>setInspected(id),onBlur:()=>setInspected(null)};return onSelect?<button key={item.id} type="button" {...shared} onClick={()=>onSelect(item,group)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(item,group)}}}>{content}</button>:<div key={item.id} {...shared} tabIndex={0} role="img">{content}</div>;})}
    </div></section>)}
   </div>:<svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${title}区块`}>
    {layout?.children?.map(group=><g key={group.data.id}><rect className={s.group} x={group.x0} y={group.y0} width={group.x1-group.x0} height={group.y1-group.y0}/><text className={s.groupLabel} x={group.x0+10} y={group.y0+19}>{group.data.label}</text></g>)}
    {leaves.map((node,index)=>{const item=node.data.item!,group=node.data.group!,w=node.x1-node.x0,h=node.y1-node.y0,cx=(node.x0+node.x1)/2,cy=(node.y0+node.y1)/2,clip=`${prefix}-${index}`,large=w>=180&&h>=110,font=Math.min(large?25:17,(w-16)/Math.max(item.label.length,1)),valueFont=Math.min(large?23:15,(w-16)/Math.max(item.displayValue.length*.58,1));return <g key={node.data.id} className={s.tile} data-color={color(item)} data-id={item.id} tabIndex={0} role={onSelect?'button':'img'} aria-label={describe(item,group)} onMouseEnter={()=>setInspected(node.data.id)} onMouseLeave={()=>setInspected(null)} onFocus={()=>setInspected(node.data.id)} onBlur={()=>setInspected(null)} onClick={onSelect?()=>onSelect(item,group):undefined} onKeyDown={onSelect?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(item,group)}}:undefined}>
     <title>{describe(item,group)}</title><defs><clipPath id={clip}><rect x={node.x0} y={node.y0} width={w} height={h}/></clipPath></defs>
     <rect x={node.x0} y={node.y0} width={w} height={h}/><g clipPath={`url(#${clip})`}>
      {w>40&&h>35&&font>=10&&<text className={s.name} textAnchor="middle" x={cx} y={cy-(h>=65?8:-4)} fontSize={font}>{item.label}</text>}
      {w>55&&h>=65&&valueFont>=10&&<text className={s.value} textAnchor="middle" x={cx} y={cy+20} fontSize={valueFont}>{item.displayValue}</text>}
      {large&&item.detail&&<text className={s.detail} textAnchor="middle" x={cx} y={cy+45} fontSize={11}>{item.detail.length>Math.floor(w/8)?`${item.detail.slice(0,Math.max(1,Math.floor(w/8)-1))}…`:item.detail}</text>}
     </g></g>})}
   </svg>:<div className={s.empty} role="status"><span className={s.emptyIcon} aria-hidden="true">▦</span><h3>{emptyTitle}</h3><p>{emptyMessage}</p>{emptyNote&&<small>{emptyNote}</small>}</div>}
  </div>
  <div className={s.inspector} aria-live="polite">{active?<><strong>{inspectedEntry?.group.label} › {active.label}</strong><span>{active.displayValue}</span>{active.detail&&<span>{active.detail}</span>}</>:<p>{entries.length?`指向区块或按 Tab 查看完整数值。${onSelect?'点击区块下钻。':''}`:'数据缺失时保留矩阵画布，不画虚构热力块。'}</p>}</div>
 </section>;
}
