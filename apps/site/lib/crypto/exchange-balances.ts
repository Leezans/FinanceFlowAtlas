export const EXCHANGE_ENDPOINT = 'https://api.llama.fi/protocol/binance-cex';
export const EXCHANGE_TERMS = 'https://defillama.com/terms';
const DAY = 86400;
type Snapshot = {date:number; tokens:Record<string,number>};
export type BalanceRow = {asset:string; before:number|null; after:number|null; change:number|null; priceUsd:number|null; changeAtEndPriceUsd:number|null};
export type BalanceComparison = {start:number; end:number; latest:number; excluded:number; rows:BalanceRow[]; coverageChanged:boolean; chains:string[]};

// 严格校验来源数量；缺失值绝不当作零，重复时间不猜测优先级。
function snapshots(value:unknown):Snapshot[]{
 if(!Array.isArray(value)||value.length===0) throw new Error('来源没有可验证的快照。');
 const seen = new Set<number>();
 return value.map(item=>{
  if(!item||typeof item!=='object'||!Number.isSafeInteger(item.date)||item.date<=0||seen.has(item.date)||!item.tokens||typeof item.tokens!=='object'||Array.isArray(item.tokens)) throw new Error('来源快照格式或时间重复，停止计算。');
  seen.add(item.date);
  const tokens:Record<string,number>=Object.create(null);
  for(const [key,n] of Object.entries(item.tokens)){
   if(typeof n!=='number'||!Number.isFinite(n)||n<0) throw new Error('来源包含无效数量，停止计算。');
   tokens[key]=n;
  }
  return {date:item.date,tokens};
 }).sort((a,b)=>a.date-b.date);
}

// 仅比较昨天及更早的相邻 UTC 零点快照；不把实时尾点包装成完整日。
export function compareExchangeBalances(payload:unknown,nowMs=Date.now()):BalanceComparison{
 if(!payload||typeof payload!=='object') throw new Error('来源响应无效。');
 const p=payload as Record<string,unknown>;
 if(p.name!=='Binance CEX') throw new Error('来源不是 Binance CEX。');
 const native=snapshots(p.tokens);
 const usd=snapshots(p.tokensInUsd);
 const now=Math.floor(nowMs/1000), today=Math.floor(now/DAY)*DAY;
 if(native.some(s=>s.date>now)||usd.some(s=>s.date>now)) throw new Error('来源快照时间在未来。');
 const completed=native.filter(s=>s.date%DAY===0&&s.date<today);
 const end=completed.at(-1),start=completed.at(-2);
 if(!start||!end||end.date-start.date!==DAY) throw new Error('没有连续的完整 UTC 日快照，不补零或跨缺口推算。');
 const valuation=usd.find(s=>s.date===end.date);
 const keys=[...new Set([...Object.keys(start.tokens),...Object.keys(end.tokens)])].sort();
 const rows=keys.map(asset=>{
  const before=start.tokens[asset]??null,after=end.tokens[asset]??null;
  const change=before!==null&&after!==null?after-before:null;
  const value=valuation?.tokens[asset];
  const price=after!==null&&after>0&&value!==undefined?value/after:null;
  const priceUsd=price!==null&&Number.isFinite(price)?price:null;
  const estimate=change!==null&&priceUsd!==null?change*priceUsd:null;
  return {asset,before,after,change:change!==null&&Number.isFinite(change)?change:null,priceUsd,changeAtEndPriceUsd:estimate!==null&&Number.isFinite(estimate)?estimate:null};
 });
 return {start:start.date,end:end.date,latest:native[native.length-1].date,excluded:native.filter(s=>s.date>end.date).length,rows,coverageChanged:rows.some(r=>r.before===null||r.after===null),chains:Array.isArray(p.chains)?p.chains.filter((c):c is string=>typeof c==='string'):[]};
}
