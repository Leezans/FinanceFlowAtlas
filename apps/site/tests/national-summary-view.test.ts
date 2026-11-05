import {describe,expect,it} from 'vitest';
import {summaryReplySchema,summaryGroups,visibleSummary,SUMMARY_CACHE_AGE_MS} from '../lib/national/tpex-summary-view';
import {matrixAreaModel,monetaryTreemap} from '../lib/matrix/layout';
import {summaryFixture,SUMMARY_TEST_NOW} from './national-summary-fixture';
describe('own-market monetary presentation',()=>{
 it('has three disjoint participants, not a duplicated total or foreign countries',()=>{
  const reply=summaryReplySchema.parse(summaryFixture()),groups=summaryGroups(reply.snapshot),area=matrixAreaModel(groups);
  expect(groups[0].items.map(row=>row.id)).toEqual(['foreign','trust','dealer']);expect(area.compatible).toBe(true);expect(area.currency).toBe('TWD');
  const leaves=monetaryTreemap(groups,900,500).leaves;expect(leaves).toHaveLength(2);expect(leaves.find(row=>row.entry.item.id==='foreign')?.share).toBeCloseTo(2/3);
  expect(groups[0].items.find(row=>row.id==='dealer')?.amount?.value).toBe(0);
 });
 it('does not create geometry from missing money or geography',()=>{expect(summaryGroups(null)).toEqual([]);});
 it('expires cache and report independently and does not treat future dates as fresh',()=>{
  const reply=summaryFixture();expect(visibleSummary(reply,SUMMARY_TEST_NOW)).toBeTruthy();expect(visibleSummary(reply,SUMMARY_TEST_NOW+SUMMARY_CACHE_AGE_MS+1)).toBeNull();expect(visibleSummary(reply,SUMMARY_TEST_NOW-1)).toBeNull();
  reply.snapshot!.report_date='2026-10-01';expect(visibleSummary(reply,SUMMARY_TEST_NOW)).toBeNull();
 });
 it('rejects amount scale/currency changes and inconsistent availability',()=>{
  const reply=summaryFixture();expect(summaryReplySchema.safeParse({...reply,snapshot:{...reply.snapshot,unit:'TWD millions'}}).success).toBe(false);
  expect(summaryReplySchema.safeParse({...reply,status:{...reply.status,state:'denied'}}).success).toBe(false);
  expect(summaryReplySchema.safeParse({...reply,snapshot:null}).success).toBe(false);
 });
});
