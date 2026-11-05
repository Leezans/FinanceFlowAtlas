import {describe,expect,it} from 'vitest';
import {japanGroups,japanMoney} from '../lib/japan/view';
import {japanFixture} from './japan-mof-ui-fixture';
describe('Japan MOF monetary presentation',()=>{
  it('uses three nonoverlapping asset categories without a repeated total or fake industries',()=>{
    const snapshot=japanFixture().snapshot!;
    const groups=japanGroups(snapshot);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(item=>item.id)).toEqual(['equity_funds','long_term_debt','short_term_debt']);
    expect(groups[0].items[0].amount).toEqual({value:1_000_000_000,currency:'JPY',comparisonKey:'japan-mof:2026-10-25:2026-10-31'});
    expect(groups[0].items[1].colorValue).toBe(-5);
    expect(groups[0].items[2].amount?.value).toBe(0);
  });
  it('labels source scaling explicitly and never fabricates missing amounts',()=>{
    expect(japanMoney(1000)).toBe('+1,000 亿 JPY');
    expect(japanMoney(-5)).toBe('-5 亿 JPY');
    expect(japanMoney(0)).toBe('0 亿 JPY');
    expect(japanGroups(null)).toEqual([]);
  });
});
