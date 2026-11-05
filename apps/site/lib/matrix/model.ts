/**
 * Presentation values only. Source adapters own units, observations, coverage,
 * missing reasons and financial calculations; a renderer never infers them.
 * A null color value is unknown, while zero is an observed neutral value.
 */
export type MatrixItem = {
  id: string;
  label: string;
  displayValue: string;
  detail?: string;
  colorValue?: number | null;
  /** Source-declared monetary metric. Never infer it from formatted text or color. */
  amount?: { value: number | null; currency: string; comparisonKey: string };
  /** Legacy presentation-only metadata; ignored for area. */
  weight?: number | null;
};
export type MatrixGroup = { id: string; label: string; items: MatrixItem[] };
export type MatrixColorMode = 'signed' | 'neutral' | 'sequential';
export type MatrixEntry = { id: string; item: MatrixItem; group: MatrixGroup };
export type MatrixColor = 'missing' | 'zero' | `positive-${1 | 2 | 3}` | `negative-${1 | 2 | 3}` | `magnitude-${1 | 2 | 3}`;

export function matrixEntries(groups: readonly MatrixGroup[]): MatrixEntry[] {
  return groups.flatMap(group => group.items.map(item => ({
    id: `${group.id}/${item.id}`, item, group,
  })));
}

export function matrixColorMaximum(entries: readonly MatrixEntry[], fixedMaximum?: number): number {
  if (typeof fixedMaximum === 'number' && Number.isFinite(fixedMaximum) && fixedMaximum > 0) {
    return fixedMaximum;
  }
  return entries.reduce((maximum, {item}) => {
    const value = item.colorValue;
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(maximum, Math.abs(value)) : maximum;
  }, 0);
}

export function matrixColor(item: MatrixItem, mode: MatrixColorMode, maximum: number): MatrixColor {
  const value = item.colorValue;
  if (mode === 'neutral' || value == null || !Number.isFinite(value)) return 'missing';
  if (mode === 'sequential' && value < 0) return 'missing';
  if (value === 0) return 'zero';
  const band = Math.min(3, Math.max(1, Math.ceil(Math.abs(value) / maximum * 3))) as 1 | 2 | 3;
  if (mode === 'sequential') return `magnitude-${band}`;
  return `${value > 0 ? 'positive' : 'negative'}-${band}`;
}

export function describeMatrixItem(item: MatrixItem, group: MatrixGroup): string {
  return `${group.label} · ${item.label} · ${item.displayValue}${item.detail ? ` · ${item.detail}` : ''}`;
}

/** Dense grids keep readable labels instead of shrinking to a fixed canvas. */
export const readableGridColumns = (width: number) => Math.max(1, Math.floor((Math.max(0, width) - 8) / 136));
