import type {MatrixGroup} from '@/lib/matrix/model';
import {intensity,type CvmSnapshot} from '@/lib/cvm/model';
export const money=(cents:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);
export const signedMoney=(cents:number)=>`${cents>0?'+':''}${money(cents)}`;
export const compactMoney=(cents:number)=>`${cents>0?'+':''}R$${new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).format(cents/100)}`;
export function industries(snapshot:CvmSnapshot){
 return [...new Set(snapshot.rows.map(r=>r.industry))].sort().map(industry=>{
  const rows=snapshot.rows.filter(r=>r.industry===industry),known=rows.filter(r=>r.flow!==null);
  const totals=known.length?known.reduce((sum,r)=>({buy:sum.buy+r.flow!.buy,sell:sum.sell+r.flow!.sell,net:sum.net+r.flow!.net}),{buy:0,sell:0,net:0}):null;
  return {industry,rows,known:known.length,missing:rows.length-known.length,totals};
 });
}
/** Industry area is additive over security magnitudes, not the absolute signed subtotal. */
export function cvmMatrixGroups(snapshot:CvmSnapshot,industry:string|null):MatrixGroup[]{
 const groups=industries(snapshot);
 const amount=(value:number|null,metric:string)=>({
  value:value===null?null:value/100,
  currency:'BRL',
  comparisonKey:`cvm:${metric}:${snapshot.period}:public-funds`,
 });
 if(industry===null)return [{
  id:'industries',label:'CVM 官方行业分类 · 公开披露基金的股票月度交易',
  items:groups.map(group=>({
   id:group.industry,label:industryLabel(group.industry),
   displayValue:group.totals?compactMoney(group.totals.net):'未知',
   detail:`${group.industry} · ${group.known}/${group.rows.length} 只证券有报告`,
   colorValue:intensity(group.totals),
   amount:amount(group.totals?group.rows.reduce((total,row)=>total+Math.abs(row.flow?.net??0),0):null,'sum-absolute-security-net'),
  })),
 }];
 const group=groups.find(group=>group.industry===industry);
 if(!group)return [];
 return [{id:group.industry,label:group.industry,items:group.rows.map(row=>({
  id:row.code,label:row.code,displayValue:row.flow?compactMoney(row.flow.net):'未知',
  detail:row.name,colorValue:intensity(row.flow),
  amount:amount(row.flow?.net??null,'security-net'),
 }))}];
}
/** Display translations only; grouping keys always remain exact CVM categories. */
const labels:Record<string,string>={
 'Serviços Transporte e Logística':'运输物流','Energia Elétrica':'电力','Construção Civil, Mat. Constr. e Decoração':'建筑建材装饰','Const. Civil, Mat. Const. e Decoração':'建筑建材装饰','Comércio (Atacado e Varejo)':'批发零售','Saneamento, Serv. Água e Gás':'供水燃气环境','Sem Setor Principal':'无主要行业','Bancos':'银行','Máquinas, Equipamentos, Veículos e Peças':'机械车辆零件','Máqs., Equip., Veíc. e Peças':'机械车辆零件','Têxtil e Vestuário':'纺织服装','Serviços médicos':'医疗服务','Metalurgia e Siderurgia':'冶金钢铁','Alimentos':'食品','Telecomunicações':'电信','Comunicação e Informática':'通信信息','Agricultura (Açúcar, Álcool e Cana)':'农业糖醇','Securitização de Recebíveis':'应收款证券化','Petróleo e Gás':'石油天然气','Farmacêutico e Higiene':'制药日化','Educação':'教育','Petroquímicos e Borracha':'石化橡胶','Extração Mineral':'采矿','Intermediação Financeira':'金融中介','Hospedagem e Turismo':'酒店旅游','Brinquedos e Lazer':'玩具休闲','Seguradoras e Corretoras':'保险经纪','Papel e Celulose':'纸浆造纸','Crédito Imobiliário':'房地产信贷','Bebidas e Fumo':'饮料烟草','Arrendamento Mercantil':'融资租赁','Bolsas de Valores/Mercadorias e Futuros':'证券期货交易所','Reflorestamento':'林业','Embalagens':'包装',
};
export function industryLabel(original:string){const prefix='Emp. Adm. Part. - ';return original.startsWith(prefix)?`控股·${labels[original.slice(prefix.length)]??original.slice(prefix.length)}`:labels[original]??original;}
