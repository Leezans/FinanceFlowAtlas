import type {MatrixGroup} from '@/lib/matrix/model';
import {coverage,exactAmount,numeric,scopeKey,type EvidenceRow,type ValidEvidence} from './model';

/** Only validated, same-scope f62 amounts can share A-share matrix area. */
export function evidenceMatrixGroup(snapshot:ValidEvidence, rows:EvidenceRow[]):MatrixGroup {
 const scope=scopeKey(snapshot.scope);
 const {denominator}=coverage({...snapshot,rows});
 return {
  id:scope,
  label:snapshot.scope.kind==='industry_rank'?'行业主力净额':'成分股主力净额',
  items:rows.map(row=>{
   const amount=numeric(row.f62),priceReturn=numeric(row.f3);
   const share=amount===null?'—（缺失）':amount===0?'—（零值）':`${(Math.abs(amount)/denominator*100).toFixed(2)}%`;
   return {
    id:row.f12,label:row.f14,displayValue:`主力净额 ${exactAmount(amount)} 元`,
    detail:`${row.f12} · 涨跌幅 ${priceReturn===null?'未提供':`${exactAmount(priceReturn)}%`} · 当前面积占比 ${share} · 供应商订单分类代理，非真实新增资金`,
    amount:{value:amount,currency:'CNY',comparisonKey:`ashare:f62:${scope}`},colorValue:amount,
   };
  }),
 };
}
