'use client';
import React,{useState} from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {PRODUCTS,PARTICIPANTS,type FuturesSnapshot} from '@/lib/futures/taifex/model';
import {taifexRows,taifexMatrixGroups,numberText,productLabel,rowLabel,type Side} from './matrix';
import s from './taifex.module.css';
export default function TaifexMatrix({snapshot}:{snapshot:FuturesSnapshot|null}){
 const [side,setSide]=useState<Side>('buy'),[product,setProduct]=useState(''),[participant,setParticipant]=useState(''),[selected,setSelected]=useState('');
 const effectiveProduct=snapshot?.covered_products.some(id=>id===product)?product:'';
 // Clear a removed filter/selection so a later report cannot resurrect it.
 if(product!==effectiveProduct)setProduct(effectiveProduct);
 if(selected&&!snapshot?.rows.some(row=>row.id===selected))setSelected('');
 const row=taifexRows(snapshot,effectiveProduct,participant).find(row=>row.id===selected);
 return <section aria-label="臺灣期貨矩陣工作區"><div className={s.controls}>
 <label>金額方向<select aria-label="金額方向" value={side} onChange={e=>setSide(e.target.value as Side)}><option value="buy">BUY · 買方契約名目成交金額</option><option value="sell">SELL · 賣方契約名目成交金額</option></select></label>
 <label>商品群組<select aria-label="商品群組" value={effectiveProduct} onChange={e=>setProduct(e.target.value)}><option value="">全部商品</option>{PRODUCTS.filter(p=>snapshot?.covered_products.includes(p.id)).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
 <label>法人身分<select aria-label="法人身分" value={participant} onChange={e=>setParticipant(e.target.value)}><option value="">全部三類法人</option>{PARTICIPANTS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
 </div><MatrixHeatmap title="TAIFEX 法人期貨商品矩陣" groups={taifexMatrixGroups(snapshot,side,effectiveProduct,participant)} description="按來源實際涵蓋商品群組分組，區塊為法人身分。商品群組可能重疊，不是互斥產業分類。切換與篩選只使用本地報表。" areaMeaning={`${side==='buy'?'BUY 買方':'SELL 賣方'}契約名目成交金額（TWD）；不加總買賣雙方`} colorMeaning="同一方向契約名目成交金額，顏色越深金額越高；不是漲跌或資金淨流入" colorMode="sequential" selectedItemId={row?.id} onSelect={item=>setSelected(item.id)} scopeKey={`${side}/${effectiveProduct}/${participant}`} emptyTitle="暫無可核驗臺灣期貨報表" emptyMessage="等待有效官方報表或調整篩選；不以示例資料填充。" emptyNote="零值不占面積，仍可在完整數值明細中選取。"/>
 {row&&<section className={s.detail} aria-label="法人期貨明細"><h2>{productLabel(row.product)} · {rowLabel(row)}</h2><p>報表日期：{snapshot?.report_date}（臺北交易日）</p><dl>{[
 ['買方成交口數',`${numberText(row.buy_contracts)} 口`],['賣方成交口數',`${numberText(row.sell_contracts)} 口`],['來源買賣淨口數',`${numberText(row.net_contracts)} 口`],
 ['買方契約名目成交金額',`${numberText(row.buy_amount)} TWD`],['賣方契約名目成交金額',`${numberText(row.sell_amount)} TWD`],['來源買賣契約名目淨額',`${numberText(row.reported_net_amount)} TWD`],
 ['多方未平倉口數',`${numberText(row.long_oi_contracts)} 口`],['空方未平倉口數',`${numberText(row.short_oi_contracts)} 口`],['來源未平倉淨口數',`${numberText(row.net_oi_contracts)} 口`],
 ['多方未平倉契約名目金額',`${numberText(row.long_oi_amount)} TWD`],['空方未平倉契約名目金額',`${numberText(row.short_oi_amount)} TWD`],['來源未平倉契約名目淨額',`${numberText(row.reported_net_oi_amount)} TWD`]
 ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>原始金額以千元 TWD 發布，此處乘以 1,000 顯示。來源淨額獨立四捨五入，可能與買方減賣方相差 1,000 TWD；保留來源值，不重新推算。未平倉與成交指標分開，不作面積加總。</p><p>以上來源淨額是契約名目差額，不是現金淨流入。<a href={PRODUCTS.find(product=>product.id===row.product)?.definition_url} target="_blank" rel="noreferrer">官方金額與幣別說明</a></p><button type="button" onClick={()=>setSelected('')}>關閉明細</button></section>}
 </section>;
}
