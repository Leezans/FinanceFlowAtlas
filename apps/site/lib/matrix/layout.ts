import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { matrixEntries, type MatrixEntry, type MatrixGroup } from './model';

export type AmountStatus = 'amount' | 'zero' | 'missing' | 'unavailable';
export function amountStatus(entry: MatrixEntry): AmountStatus {
  const amount = entry.item.amount;
  if (!amount || !amount.currency.trim() || !amount.comparisonKey.trim()) return 'unavailable';
  if (amount.value === null || !Number.isFinite(amount.value)) return 'missing';
  return amount.value === 0 ? 'zero' : 'amount';
}

/** Only source-declared, same-currency, same-metric observations share an area scale. */
export function matrixAreaModel(groups: readonly MatrixGroup[]) {
  const entries = matrixEntries(groups);
  const declared = entries.filter(entry => entry.item.amount);
  const keys = new Set(declared.map(({ item }) => JSON.stringify([item.amount!.currency, item.amount!.comparisonKey])));
  const compatible = declared.length > 0 && declared.length === entries.length && keys.size === 1
    && new Set(groups.map(group => group.id)).size === groups.length && new Set(entries.map(entry => entry.id)).size === entries.length
    && declared.every(({ item }) => item.amount!.currency.trim() && item.amount!.comparisonKey.trim());
  const weighted = compatible ? entries.filter(entry => amountStatus(entry) === 'amount') : [];
  // Scaling by the maximum avoids overflowing the sum and preserves all ratios.
  const maximum = weighted.reduce((max, entry) => Math.max(max, Math.abs(entry.item.amount!.value!)), 0);
  const normalizedTotal = weighted.reduce((sum, entry) => sum + Math.abs(entry.item.amount!.value!) / maximum, 0);
  return {
    entries, compatible, weighted,
    currency: compatible ? declared[0].item.amount!.currency : null,
    reason: !entries.length ? 'empty' : !declared.length ? 'nonmonetary' : compatible ? 'comparable' : 'incomparable',
    weight: (entry: MatrixEntry) => compatible && amountStatus(entry) === 'amount' ? Math.abs(entry.item.amount!.value!) / maximum : 0,
    share: (entry: MatrixEntry) => compatible && amountStatus(entry) === 'amount' ? Math.abs(entry.item.amount!.value!) / maximum / normalizedTotal : null,
  } as const;
}

type LayoutNode = { id: string; group?: MatrixGroup; entry?: MatrixEntry; children?: LayoutNode[] };
export type MatrixRectangle = { id: string; x: number; y: number; width: number; height: number; entry: MatrixEntry; share: number };
export type MatrixGroupRectangle = { id: string; label: string; x: number; y: number; width: number; height: number };

/** No padding, rounding, minimum area, fabricated weights, or signed cancellation. */
export function monetaryTreemap(groups: readonly MatrixGroup[], width: number, height: number) {
  const model = matrixAreaModel(groups);
  if (!model.compatible || !model.weighted.length || width <= 0 || height <= 0) return { leaves: [], groups: [] };
  const byGroup = new Map<string, MatrixEntry[]>();
  for (const entry of model.weighted) {
    const bucket = byGroup.get(entry.group.id) ?? [];
    bucket.push(entry); byGroup.set(entry.group.id, bucket);
  }
  const root = hierarchy<LayoutNode>({ id: 'root', children: groups.filter(group => byGroup.has(group.id)).map(group => ({
    id: group.id, group, children: byGroup.get(group.id)!.map(entry => ({ id: entry.id, entry })),
  })) }).sum(node => node.entry ? model.weight(node.entry) : 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const layout = treemap<LayoutNode>().tile(treemapSquarify).size([width, height]).padding(0).round(false)(root);
  return {
    leaves: layout.leaves().filter(node => node.data.entry).map(node => ({
      id: node.data.id, x: node.x0, y: node.y0, width: node.x1 - node.x0, height: node.y1 - node.y0,
      entry: node.data.entry!, share: model.share(node.data.entry!)!,
    })) satisfies MatrixRectangle[],
    groups: (layout.children ?? []).map(node => ({ id: node.data.id, label: node.data.group!.label,
      x: node.x0, y: node.y0, width: node.x1 - node.x0, height: node.y1 - node.y0,
    })) satisfies MatrixGroupRectangle[],
  };
}
