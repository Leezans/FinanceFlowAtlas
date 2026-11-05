import type { MatrixGroup } from '@/lib/matrix/model';
import { CONTRACTS, net, type CftcSnapshot } from '@/lib/futures/model';

export const TRADER_GROUPS = [
  { id: 'noncommercial', label: '非商业交易者' },
  { id: 'commercial', label: '商业交易者' },
  { id: 'nonreportable', label: '非报告持仓' },
] as const;
export type TraderGroup = typeof TRADER_GROUPS[number]['id'];

// App navigation categories, not a CFTC industry classification or an aggregate.
export const FUTURES_CATEGORIES = [
  { id: 'precious-metals', label: '贵金属', code: '088691' },
  { id: 'energy', label: '能源', code: '067651' },
  { id: 'agriculture', label: '农产品', code: '002602' },
  { id: 'currency-futures', label: '外汇期货', code: '099741' },
] as const;

export function futuresMatrixGroups(snapshot: CftcSnapshot, trader: TraderGroup): MatrixGroup[] {
  const traderLabel = TRADER_GROUPS.find(group => group.id === trader)!.label;
  return FUTURES_CATEGORIES.flatMap(category => {
    const row = snapshot.rows.find(row => row.code === category.code);
    if (!row) return [];
    const contract = CONTRACTS.find(contract => contract.code === row.code)!;
    const value = net(row.current, trader);
    const ratio = value / row.current.open_interest;
    const signedContracts = `${value > 0 ? '+' : ''}${value.toLocaleString('zh-CN')}`;
    return [{
      id: category.id,
      label: category.label,
      items: [{
        id: row.code,
        label: contract.label,
        displayValue: `${ratio > 0 ? '+' : ''}${(ratio * 100).toFixed(1)}% OI`,
        detail: `${traderLabel}净持仓 ${signedContracts} 张`,
        colorValue: ratio,
        weight: 1,
      }],
    }];
  });
}
