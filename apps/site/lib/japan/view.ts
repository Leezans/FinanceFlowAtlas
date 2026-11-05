/** Display only. Official acquisition/disposition/net figures remain unmodified. */
import type {MatrixGroup} from '@/lib/matrix/model';
import type {JapanMofSnapshot} from './model';

export type JapanAsset = JapanMofSnapshot['assets'][number]['id'];
export const assetLabels:Record<JapanAsset,string> = {
  equity_funds:'股票及投资基金份额',
  long_term_debt:'长期债务证券',
  short_term_debt:'短期债务证券',
};
export const japanMoney = (value:number) => `${value>0?'+':''}${value.toLocaleString('zh-CN')} 亿 JPY`;
export function japanGroups(snapshot:JapanMofSnapshot|null):MatrixGroup[]{
  if(!snapshot)return [];
  return [{id:'JPN-MOF',label:'日本证券 · 非居民净买卖',items:snapshot.assets.map(asset=>({
    id:asset.id,label:assetLabels[asset.id],displayValue:japanMoney(asset.net),colorValue:asset.net,
    detail:`${snapshot.report_start} 至 ${snapshot.report_end} · 取得 ${japanMoney(asset.acquisitions)} / 处置 ${japanMoney(asset.dispositions)}`,
    amount:{value:asset.net*100_000_000,currency:'JPY',comparisonKey:`japan-mof:${snapshot.report_start}:${snapshot.report_end}`},
  }))}];
}
