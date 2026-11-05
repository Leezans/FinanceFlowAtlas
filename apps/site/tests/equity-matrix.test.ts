import {describe, expect, it} from 'vitest';
import {annualUsd, equityYears, projectCountryEquity, projectEquityMatrix} from '../lib/equity/matrix';
import {matrixColor} from '../lib/matrix/model';
import {reply} from './equity-fixture';
const snapshot = () => reply().snapshot!;
const items = (projection: ReturnType<typeof projectEquityMatrix>) => projection.groups.flatMap(group => group.items);
describe('annual equity matrix projection', () => {
  it('groups all geographic slots without inflating observation coverage or creating zero values', () => {
    const result = projectEquityMatrix(snapshot(), 'capitalization');
    expect(items(result)).toHaveLength(249); expect(result.observed).toBe(2); expect(result.displayedObserved).toBe(2);
    expect(result.groups.find(group => group.id === 'Americas')!.items.find(item => item.id === 'USA')!.colorValue).toBe(1e9);
    const unknown = items(result).find(item => item.id === 'AFG')!;
    expect(unknown.displayValue).toBe('所选年无观测'); expect(unknown.colorValue).toBeNull();
    expect(unknown.detail).toContain('2023–2025 窗口无该项观测');
    expect(unknown.amount).toMatchObject({value:null,currency:'USD'});
    expect(items(result).find(item=>item.id==='USA')!.amount).toMatchObject({value:1e9,currency:'USD'});
    expect(new Set(items(result).map(item=>item.amount?.comparisonKey)).size).toBe(1);
    expect(items(result).some(item => item.id === 'WLD')).toBe(false);
  });
  it('never mixes annual observations, and labels the retained latest-year limitation', () => {
    expect(equityYears(snapshot(), 'traded_value')).toEqual([2025, 2024]);
    const latest = projectEquityMatrix(snapshot(), 'traded_value');
    expect(latest.observed).toBe(1);
    const japan = items(latest).find(item => item.id === 'JPN')!;
    expect(japan.colorValue).toBeNull(); expect(japan.detail).toContain('最近观测为 2024 年，未混入');
    expect(latest.year).toBe(2025); expect(japan.amount?.value).toBeNull();
    expect(items(latest)[0].amount?.comparisonKey).not.toBe(items(projectEquityMatrix(snapshot(),'capitalization'))[0].amount?.comparisonKey);
  });
  it('preserves the global same-year color scale through a region filter', () => {
    const all = projectEquityMatrix(snapshot(), 'capitalization');
    const asia = projectEquityMatrix(snapshot(), 'capitalization', 'Asia');
    expect(asia.maximum).toBe(all.maximum); expect(asia.observed).toBe(2); expect(asia.displayedObserved).toBe(1);
    expect(asia.groups.map(group => group.id)).toEqual(['Asia']);
  });
  it('keeps explicit zero distinct from missing and does not round small values to zero', () => {
    const data = snapshot(); data.rows[0].capitalization!.usd = 0;
    const result = projectEquityMatrix(data, 'capitalization');
    const zero = items(result).find(item => item.id === data.rows[0].iso3)!;
    expect(zero.amount?.value).toBe(0); expect(zero.colorValue).toBe(0); expect(zero.displayValue).toBe('0 美元');
    expect(matrixColor(zero, 'sequential', result.maximum)).toBe('zero');
    expect(annualUsd(.125)).toBe('0.125 美元');
  });
  it('keeps country metrics and latest years separate, with missing metric slots', () => {
    const japan = projectCountryEquity(snapshot(), 'JPN')[0].items;
    expect(japan[0].detail).toContain('2025 年末'); expect(japan[1].detail).toContain('2024 全年');
    expect(japan.every(item => item.amount === undefined && item.colorValue === null)).toBe(true);
    expect(projectCountryEquity(snapshot(), 'AFG')[0].items.every(item => item.displayValue === '暂无观测')).toBe(true);
  });
  it('retains an empty canvas without generating a geographic heatmap before evidence exists', () => {
    expect(projectEquityMatrix(null, 'capitalization').groups).toEqual([]);
    expect(projectCountryEquity(null, 'USA')).toEqual([]);
    expect(equityYears(null, 'capitalization')).toEqual([]);
  });
});
