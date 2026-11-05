import {numeric, type EvidenceRow} from './model';

/** The color scale is anchored to the complete validated scope, never the search result. */
export function flowScaleMaximum(rows: readonly EvidenceRow[]): number {
 return rows.reduce((maximum, row) => Math.max(maximum, Math.abs(numeric(row.f62) ?? 0)), 0);
}
