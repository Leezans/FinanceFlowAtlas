import {PRODUCTS,PARTICIPANTS,type FuturesSnapshot,type FuturesRow} from '@/lib/futures/taifex/model';
import type {MatrixGroup} from '@/lib/matrix/model';
export type Side='buy'|'sell';
export const numberText=(n:number)=>n.toLocaleString('zh-TW');
export const productLabel=(id:string)=>PRODUCTS.find(p=>p.id===id)?.label??id;
export const participantLabel=(id:string)=>PARTICIPANTS.find(p=>p.id===id)?.label??id;
export const rowLabel=(row:FuturesRow)=>participantLabel(row.participant);
export function taifexRows(snapshot:FuturesSnapshot|null,product='',participant=''){
 return (snapshot?.rows??[]).filter(row=>(!product||row.product===product)&&(!participant||row.participant===participant));
}
export function taifexMatrixGroups(snapshot:FuturesSnapshot|null,side:Side='buy',product='',participant=''):MatrixGroup[]{
 if(!snapshot)return [];
 const rows=taifexRows(snapshot,product,participant);
 const comparisonKey=`taifex-futures/${snapshot.report_date}/${snapshot.acquisition_started_at}/${side}_amount/TWD/daily`;
 return PRODUCTS.map(p=>({id:p.id,label:p.label,items:rows.filter(row=>row.product===p.id).map(row=>{
  const amount=side==='buy'?row.buy_amount:row.sell_amount;
  return {id:row.id,label:rowLabel(row),displayValue:`${numberText(amount)} TWD`,detail:`報表 ${snapshot.report_date} · ${side==='buy'?'買方':'賣方'}契約名目成交金額`,colorValue:amount,amount:{value:amount,currency:'TWD',comparisonKey}};
 })})).filter(group=>group.items.length);
}
