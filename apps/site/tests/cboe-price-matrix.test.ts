import {it,expect} from 'vitest';
import {cboeMatrixGroups} from '../lib/cboe/matrix';
import type {CboeQuote} from '../lib/cboe/model';
it('groups exact currency, retains timestamps, and never supplies flow, return, industry or area',()=>{
 const row:CboeQuote={isin:'GB0000000001',price:'12.34',currency:'GBX',tradeId:'T1',tradeTime:'2026-11-05T12:00:00.000001Z',publicationTime:'2026-11-05T12:00:00.000002Z',executionVenue:'BATE',publicationVenue:'BATE',sourceFile:null};
 const groups=cboeMatrixGroups([row,{...row,currency:'GBP'}]);expect(groups.map(g=>g.id)).toEqual(['GBP','GBX']);
 for(const group of groups){const item=group.items[0];expect(item.colorValue).toBeNull();expect(item).not.toHaveProperty('amount');expect(item).not.toHaveProperty('weight');expect(item.detail).toContain(row.tradeTime);expect(item.detail).toContain(row.publicationTime);expect(item.displayValue).toContain(group.id);expect(item.label).toBe(row.isin);}
});

it('displays exact 18-character-or-shorter source decimals without rounding or scaling',()=>{
 for(const price of ['9007199254740993','0.0000000000001','12.34000000']){
  const row:CboeQuote={isin:'GB0000000001',price,currency:'GBP',tradeId:'T1',tradeTime:'2026-11-05T12:00:00.000001Z',publicationTime:'2026-11-05T12:00:00.000002Z',executionVenue:'BATE',publicationVenue:'BATE',sourceFile:null};
  expect(cboeMatrixGroups([row])[0].items[0].displayValue).toBe(`${price} GBP`);
 }
});
