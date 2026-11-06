import type { MatrixGroup } from '@/lib/matrix/model';
import { CONTRACTS, FUTURES_CATEGORIES, net, type CftcSnapshot } from '@/lib/futures/model';

export const TRADER_GROUPS = [
  { id: 'noncommercial', label: '非商业交易者' },
  { id: 'commercial', label: '商业交易者' },
  { id: 'nonreportable', label: '非报告持仓' },
] as const;
export type TraderGroup = typeof TRADER_GROUPS[number]['id'];

export {FUTURES_CATEGORIES} from '@/lib/futures/model';

export function futuresMatrixGroups(snapshot: CftcSnapshot, trader: TraderGroup): MatrixGroup[] {
  const traderLabel = TRADER_GROUPS.find(group => group.id === trader)!.label;
  return FUTURES_CATEGORIES.flatMap(category => {
    const rows = snapshot.rows.filter(row => CONTRACTS.find(c => c.code === row.code)?.category === category.id);
    if (!rows.length) return [];
    return [{id: category.id, label: category.label, items: rows.map(row => {
      const contract = CONTRACTS.find(contract => contract.code === row.code)!;
      const value = net(row.current, trader), ratio = value / row.current.open_interest;
      const signedContracts = `${value > 0 ? '+' : ''}${value.toLocaleString('zh-CN')}`;
      return {
        id: row.code,
        label: contract.label,
        displayValue: `${ratio > 0 ? '+' : ''}${(ratio * 100).toFixed(1)}% OI`,
        detail: `${contract.venue} · ${traderLabel}净持仓 ${signedContracts} 张`,
        colorValue: ratio,
      };
    })}];
  });
}
