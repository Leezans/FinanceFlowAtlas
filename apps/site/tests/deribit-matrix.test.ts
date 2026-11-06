import {describe,it,expect} from 'vitest';
import {optionsMatrixGroups} from '../components/options/matrix';
import {matrixAreaModel,monetaryTreemap} from '../lib/matrix/layout';
import {optionsReply} from './deribit-fixture';
describe('Deribit amount matrix',()=>{
 it('uses source USD amounts and exact 3:1 area, retaining zero in details',()=>{const groups=optionsMatrixGroups(optionsReply().snapshot),model=matrixAreaModel(groups),rects=monetaryTreemap(groups,1000,500);expect(model.compatible).toBe(true);expect(model.entries).toHaveLength(3);expect(rects.leaves).toHaveLength(2);expect(rects.leaves[0].width*rects.leaves[0].height/(rects.leaves[1].width*rects.leaves[1].height)).toBeCloseTo(3,10);expect(model.entries[2].item.colorValue).toBeNull();expect(new Set(model.entries.map(item=>item.item.amount!.comparisonKey)).size).toBe(1);});
 it('filters by expiry, side and instrument, without removing zero rows',()=>{const snap=optionsReply().snapshot;expect(optionsMatrixGroups(snap,'90000')[0].items[0].amount!.value).toBe(0);expect(optionsMatrixGroups(snap,'','','put')[0].items).toHaveLength(1);expect(optionsMatrixGroups(snap,'','1')).toEqual([]);});
 it('does not reuse a comparison scope across source snapshots',()=>{const a=optionsReply().snapshot!,b={...a,source_as_of:'2026-11-06T03:01:00Z'};expect(optionsMatrixGroups(a)[0].items[0].amount!.comparisonKey).not.toBe(optionsMatrixGroups(b)[0].items[0].amount!.comparisonKey);});
 it('never infers a return for zero-volume contracts',()=>{const snapshot=optionsReply().snapshot!;snapshot.rows[0].volume=0;expect(optionsMatrixGroups(snapshot)[0].items[0].colorValue).toBeNull();});
});
