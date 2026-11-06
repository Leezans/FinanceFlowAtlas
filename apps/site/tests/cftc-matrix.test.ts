import {describe,expect,it} from 'vitest';
import {futuresMatrixGroups,FUTURES_CATEGORIES} from '../components/futures/matrix';
import {reply,legacyReply} from './cftc-fixture';

describe('CFTC category matrix semantics',()=>{
 it('groups 52 reviewed markets without inventing sector flows, amounts or contract sums',()=>{
  const groups=futuresMatrixGroups(reply().snapshot!,'noncommercial');
  expect(groups.map(group=>group.label)).toEqual(FUTURES_CATEGORIES.map(c=>c.label));
  expect(groups.map(group=>group.items.length)).toEqual([5,5,11,3,11,8,7,2]);
  expect(groups.flatMap(group=>group.items)).toHaveLength(52);
  expect(groups.flatMap(group=>group.items).every(item=>item.amount===undefined)).toBe(true);
  expect(groups[0].items[0]).toEqual({id:'088691',label:'黄金',displayValue:'+10.0% OI',detail:'COMEX · 非商业交易者净持仓 +100 张',colorValue:.1});
  expect(groups[4].items[0].displayValue).toBe('+16.0% OI');
 });
 it('preserves negative and zero positioning independently of equal tile area',()=>{
  const snapshot=reply().snapshot!;
  expect(futuresMatrixGroups(snapshot,'commercial')[0].items[0].colorValue).toBe(-.1);
  expect(futuresMatrixGroups(snapshot,'commercial')[0].items[0].displayValue).toBe('-10.0% OI');
  for(const item of futuresMatrixGroups(snapshot,'nonreportable').flatMap(g=>g.items)){
   expect(item.colorValue).toBe(0);expect(item.displayValue).toBe('0.0% OI');expect(item.amount).toBeUndefined();
  }
 });
 it('never manufactures missing items and shows only four items for a validated legacy report',()=>{
  const legacy=futuresMatrixGroups(legacyReply().snapshot!,'noncommercial');
  expect(legacy.map(g=>g.items.length)).toEqual([1,1,1,1]);
  expect(legacy.flatMap(g=>g.items).map(i=>i.id)).toEqual(['088691','067651','002602','099741']);
  const snapshot=reply().snapshot!;snapshot.rows=snapshot.rows.filter(row=>row.code!=='088691');
  expect(futuresMatrixGroups(snapshot,'noncommercial').flatMap(g=>g.items).some(item=>item.id==='088691')).toBe(false);
 });
});
