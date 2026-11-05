import {numeric, type EvidenceRow} from './model';

/** The color scale is anchored to the complete validated scope, never the search result. */
export function flowScaleMaximum(rows: readonly EvidenceRow[]): number {
 return rows.reduce((maximum, row) => Math.max(maximum, Math.abs(numeric(row.f62) ?? 0)), 0);
}

/** Three equal-width magnitude bands. Missing and reported zero remain separate from colored tiles. */
export function flowStrength(value: number | null, maximum: number): 0 | 1 | 2 | 3 {
 if(value === null || !Number.isFinite(value) || value === 0 || !Number.isFinite(maximum) || maximum <= 0) return 0;
 const relative = Math.min(1, Math.abs(value) / maximum);
 return relative <= 1 / 3 ? 1 : relative <= 2 / 3 ? 2 : 3;
}

/** Conservative SVG text sizing: a CJK character uses one em, ASCII uses 0.65 em. */
export function fitTileFont(text: string, width: number, maximum: number): number {
 const units = Array.from(text).reduce((total, character) => total + (/[^\x00-\x7F]/.test(character) ? 1 : .65), 0);
 return Math.min(maximum, (width - 12) / Math.max(1, units));
}
