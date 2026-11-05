import type {MatrixGroup} from '../matrix/model';
import type {CboeQuote} from './model';
/** Neutral equal-area information cards. Price is neither flow nor an area metric. */
export function cboeMatrixGroups(quotes: readonly CboeQuote[]): MatrixGroup[] {
  const groups = new Map<string, MatrixGroup>();
  for (const quote of quotes) {
    const group = groups.get(quote.currency) ?? {id:quote.currency,label:quote.currency,items:[]};
    group.items.push({id:`${quote.isin}:${quote.currency}`,label:quote.isin,
      displayValue:`${quote.price} ${quote.currency}`,
      detail:`欧洲股票及 ETF · Cboe BXE/${quote.executionVenue} 部分分钟窗口 · 成交 ${quote.tradeTime} · 发布 ${quote.publicationTime} · 延迟至少 15 分钟；非资金流`,
      colorValue:null});
    groups.set(group.id,group);
  }
  return [...groups.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(group=>({...group,items:group.items.sort((a,b)=>a.label.localeCompare(b.label))}));
}
