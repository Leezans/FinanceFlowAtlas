import geography from '@/components/atlas/countries.json';
import type {MatrixGroup} from '@/lib/matrix/model';
import type {EquityMetric, EquitySnapshot} from './model';

export const EQUITY_METRICS = [
  {key: 'capitalization', label: '年末总市值', period: '年末'},
  {key: 'traded_value', label: '全年股票成交额', period: '全年'},
] as const;
const chinese = new Intl.DisplayNames(['zh-CN'], {type: 'region'});
const regionLabels: Record<string, string> = {Asia: '亚洲', Europe: '欧洲', Americas: '美洲', Africa: '非洲', Oceania: '大洋洲', Antarctic: '南极洲'};
export const equityCountries = geography.map(country => ({...country, label: chinese.of(country.iso2) || country.name}));
export const equityRegions = [...new Set(geography.map(country => country.region))].sort().map(id => ({id, label: regionLabels[id] || id}));
export const equityCountryName = (iso3: string) => equityCountries.find(country => country.iso3 === iso3)?.label || iso3;
export const annualUsd = (value: number) => value >= 1e12
  ? `${(value / 1e12).toLocaleString('zh-CN', {maximumFractionDigits: 2})} 万亿美元`
  : value >= 1e8 ? `${(value / 1e8).toLocaleString('zh-CN', {maximumFractionDigits: 2})} 亿美元`
  : `${value.toLocaleString('zh-CN', {maximumFractionDigits: 20})} 美元`;
export function equityYears(snapshot: EquitySnapshot | null, metric: EquityMetric): number[] {
  return [...new Set(snapshot?.rows.flatMap(row => row[metric] ? [row[metric]!.year] : []) || [])].sort((a, b) => b - a);
}

/** Geography supplies identity and missing slots only, never observations or totals. */
export function projectEquityMatrix(snapshot: EquitySnapshot | null, metric: EquityMetric, region = '') {
  const year = equityYears(snapshot, metric)[0] ?? null;
  const rows = new Map(snapshot?.rows.map(row => [row.iso3, row]) || []);
  const observations = snapshot?.rows.flatMap(row => row[metric]?.year === year ? [row[metric]!] : []) || [];
  const maximum = observations.reduce((max, observation) => Math.max(max, observation.usd), 0);
  const groups = new Map<string, MatrixGroup>();
  let displayedObserved = 0;
  if (snapshot) for (const country of equityCountries) {
    if (region && country.region !== region) continue;
    const latest = rows.get(country.iso3)?.[metric];
    const observation = latest?.year === year ? latest : null;
    if (observation) displayedObserved++;
    const group = groups.get(country.region) || {id: country.region, label: regionLabels[country.region] || country.region, items: []};
    group.items.push({
      id: country.iso3,
      label: country.label,
      displayValue: observation ? annualUsd(observation.usd) : '所选年无观测',
      detail: observation
        ? `${year} · ${country.iso3} · ${observation.usd.toLocaleString('zh-CN', {maximumFractionDigits: 20})} USD`
        : `${year ?? '—'} · ${country.iso3} · ${latest ? `最近观测为 ${latest.year} 年，未混入` : `${snapshot.window_start}–${snapshot.window_end} 窗口无该项观测`}`,
      colorValue: observation?.usd ?? null,
      weight: 1,
    });
    groups.set(country.region, group);
  }
  const ordered = [...groups.values()];
  // Reported values first, but every missing slot remains reachable. No top-N truncation.
  for (const group of ordered) group.items.sort((a, b) => Number(b.colorValue !== null) - Number(a.colorValue !== null) || (b.colorValue ?? 0) - (a.colorValue ?? 0) || a.label.localeCompare(b.label, 'zh-CN'));
  ordered.sort((a, b) => b.items.filter(item => item.colorValue !== null).length - a.items.filter(item => item.colorValue !== null).length || a.id.localeCompare(b.id));
  return {groups: ordered, year, maximum, observed: observations.length, displayedObserved};
}

/** Two distinct measures retain their own latest year; never divide or subtract them. */
export function projectCountryEquity(snapshot: EquitySnapshot | null, iso3: string): MatrixGroup[] {
  if (!snapshot) return [];
  const row = snapshot.rows.find(candidate => candidate.iso3 === iso3);
  return [{id: iso3, label: `${equityCountryName(iso3)} · 各指标最近非空观测`, items: EQUITY_METRICS.map(metric => {
    const observation = row?.[metric.key];
    return {
      id: metric.key, label: metric.label,
      displayValue: observation ? annualUsd(observation.usd) : '暂无观测',
      detail: observation
        ? `${observation.year} ${metric.period} · ${observation.usd.toLocaleString('zh-CN', {maximumFractionDigits: 20})} USD`
        : `${snapshot.window_start}–${snapshot.window_end} 年窗口未提供`,
      colorValue: null, weight: 1,
    };
  })}];
}
