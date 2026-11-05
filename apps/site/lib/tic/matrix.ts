import geography from '@/components/atlas/countries.json';
import type {MatrixGroup} from '@/lib/matrix/model';
import {flowDirection, selectTicRows, signedMillions, type TicSnapshot} from './model';

const regions = new Map(geography.map(country => [country.iso3, country.region]));
const names: Record<string, string> = {Asia: '亚洲', Europe: '欧洲', Americas: '美洲', Africa: '非洲', Oceania: '大洋洲', Antarctic: '南极洲', Other: '其他'};
export const countryRegion = (iso: string) => regions.get(iso) || 'Other';
export const regionName = (region: string) => names[region] || region;
export type TicMatrixScope = {country?: string; region?: string; sign?: string};
export type TicMatrixProjection = {
  groups: MatrixGroup[];
  colorMaxAbs: number;
  reportedCountries: number;
  regions: {id: string; label: string; count: number}[];
};

/** One validated TIC period only. Geography groups evidence; it never creates it. */
export function projectTicMatrix(snapshot: TicSnapshot | null, scope: TicMatrixScope = {}): TicMatrixProjection {
  const all = snapshot?.country_flows ?? [];
  const regionCounts = new Map<string, number>();
  for (const row of all) {
    const region = countryRegion(row.foreign_economy_iso3);
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
  }
  const rows = selectTicRows(snapshot, snapshot?.period ?? '', scope.country ?? '', scope.sign ?? 'all')
    .filter(row => !scope.region || countryRegion(row.foreign_economy_iso3) === scope.region);
  const grouped = new Map<string, MatrixGroup>();
  for (const row of rows) {
    const id = countryRegion(row.foreign_economy_iso3);
    const group = grouped.get(id) ?? {id, label: regionName(id), items: []};
    group.items.push({
      id: row.foreign_economy_iso3,
      label: row.foreign_economy_name,
      displayValue: `${signedMillions(row.net_foreign_purchases_usd)} USD millions`,
      detail: `${row.period} · ${row.foreign_economy_iso3} · ${flowDirection(row.net_foreign_purchases_usd)} · TIC`,
      colorValue: row.net_foreign_purchases_usd,
      amount: {value: row.net_foreign_purchases_usd, currency: 'USD', comparisonKey: `tic:equity:net-purchases:${row.period}:foreign-residences`},
    });
    grouped.set(id, group);
  }
  return {
    groups: [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id)),
    // Keep the full source-period scale when country, region or direction changes.
    colorMaxAbs: all.reduce((max, row) => Math.max(max, Math.abs(row.net_foreign_purchases_usd)), 0),
    reportedCountries: all.length,
    regions: [...regionCounts].sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => ({id, label: regionName(id), count})),
  };
}
