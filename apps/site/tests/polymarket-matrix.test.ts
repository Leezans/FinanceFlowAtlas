import {describe,expect,it} from 'vitest';
import type {PolymarketMarket} from '../lib/polymarket/model';
import {categoryKey,categoryMatrix,filterMarkets,marketItem,marketMatrix,namedOutcome} from '../components/polymarket/matrix';
const row:PolymarketMarket={id:'1',question:'Will this full and deliberately long market question retain all words in the heatmap?',category:'Science',category_basis:'source_category',tags:[],outcomes:[{name:'No',price:'1'},{name:'Yes',price:'0'}],volume_24h:0,volume_unit:'source_reported',source_record_updated_at:null,source_observed_at:null,accepting_orders:null};
describe('Polymarket pure matrix projection',()=>{
 it('keeps the complete question, explicit Yes position, true zeros and nulls',()=>{
  expect(namedOutcome(row).name).toBe('Yes');expect(marketItem(row,'probability')).toMatchObject({label:row.question,colorValue:0,displayValue:'0%',detail:'结果：Yes · 价格隐含概率'});
  expect(marketItem(row,'volume')).toMatchObject({colorValue:0,displayValue:'0 · 来源单位'});
  const missing={...row,volume_24h:null,outcomes:[{name:'No',price:'1'},{name:'Yes',price:null}]};
  expect(marketItem(missing,'probability')).toMatchObject({colorValue:null,displayValue:'来源未提供'});expect(marketItem(missing,'volume').colorValue).toBeNull();
 });
 it('names the first non-binary outcome rather than relabeling it Yes',()=>{const other={...row,outcomes:[{name:'Candidate A',price:'0.7'},{name:'Candidate B',price:'0.3'}]};expect(namedOutcome(other).name).toBe('Candidate A');expect(marketItem(other,'probability').detail).toContain('Candidate A');});
 it('uses only source categories and distinguishes tags without aggregating probabilities or volumes',()=>{
  const tag={...row,id:'2',category_basis:'source_tag' as const};const rows=[row,tag];const groups=categoryMatrix(rows);expect(groups[0].items).toHaveLength(2);expect(groups[0].items[0].displayValue).toBe('1 个市场');expect(groups[0].items[1].label).toBe('Science · 来源标签');
  expect(marketMatrix(rows,categoryKey(row),'probability')[0].items).toHaveLength(1);expect(filterMarkets(rows,'deliberately')).toHaveLength(2);expect(filterMarkets(rows,'unknown')).toEqual([]);
 });
});
