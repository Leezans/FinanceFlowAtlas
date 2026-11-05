import {describe,expect,it} from 'vitest';
import {futuresMatrixGroups} from '../components/futures/matrix';
import {reply} from './cftc-fixture';

describe('CFTC category matrix semantics',()=>{
 it('uses explicit asset groups without inventing sector flows or contract sums',()=>{
  const groups=futuresMatrixGroups(reply().snapshot!,'noncommercial');
  expect(groups.map(group=>group.label)).toEqual(['贵金属','能源','农产品','外汇期货']);
  expect(groups.map(group=>group.items.length)).toEqual([1,1,1,1]);
  expect(groups.flatMap(group=>group.items).map(item=>item.weight)).toEqual([1,1,1,1]);
  expect(groups[0].items[0]).toEqual({id:'088691',label:'黄金',displayValue:'+10.0% OI',detail:'非商业交易者净持仓 +100 张',colorValue:.1,weight:1});
  expect(groups[3].items[0].displayValue).toBe('+16.0% OI');
 });
 it('preserves negative and zero positioning independently of equal tile area',()=>{
  const snapshot=reply().snapshot!;
  expect(futuresMatrixGroups(snapshot,'commercial')[0].items[0].colorValue).toBe(-.1);
  expect(futuresMatrixGroups(snapshot,'commercial')[0].items[0].displayValue).toBe('-10.0% OI');
  for(const group of futuresMatrixGroups(snapshot,'nonreportable')){
   expect(group.items[0].colorValue).toBe(0);
   expect(group.items[0].displayValue).toBe('0.0% OI');
   expect(group.items[0].weight).toBe(1);
  }
 });
 it('does not manufacture items for a missing contract',()=>{
  const snapshot=reply().snapshot!;
  snapshot.rows=snapshot.rows.filter(row=>row.code!=='088691');
  expect(futuresMatrixGroups(snapshot,'noncommercial').some(group=>group.id==='precious-metals')).toBe(false);
 });
});
