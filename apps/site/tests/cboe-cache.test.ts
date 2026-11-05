import {describe,it,expect} from 'vitest';
import {cacheSchema,nextCboeCache,parseCboeCache,tradeKey} from '../lib/cboe/cache';
import {MAX_SNAPSHOT_CHARS} from '../lib/cboe/model';
import {MAX_CACHE_AGE_MS,replySchema} from '../lib/cboe/service-model';
import {fixture,reply,NOW} from './cboe-fixture';
const safe={safeEmptyWindow:true,reportedTradeKeys:[]};
const empty=(age=60_000)=>({...fixture(),acquisitionStartedAt:new Date(NOW+age).toISOString(),fetchedAt:new Date(NOW+age).toISOString(),rows:[],coverage:{rawRows:1,rejectedRows:1,qualifiedRows:0}});
describe('bounded Cboe retained evidence',()=>{
 it('reads legacy snapshots but requires explicit new collection safety to retain',()=>{
  const old=parseCboeCache(fixture());expect(old.latestEmptyCheck).toBeNull();
  expect(nextCboeCache(old,empty()).snapshot.rows).toEqual([]);
 });
 it('keeps price and source clocks unchanged while recording a later successful empty check',()=>{
  const old=parseCboeCache(fixture()),retained=nextCboeCache(old,empty(),safe);
  expect(retained.snapshot).toEqual(fixture());expect(retained.latestEmptyCheck).toEqual(empty());
  const again=nextCboeCache(retained,empty(120_000),safe);
  expect(again.snapshot.fetchedAt).toBe(fixture().fetchedAt);expect(again.latestEmptyCheck?.fetchedAt).toBe(empty(120_000).fetchedAt);
 });
 it('expires using the original acquisition, never a later empty check',()=>{
  const old=nextCboeCache(parseCboeCache(fixture()),empty(),safe);
  expect(nextCboeCache(old,empty(MAX_CACHE_AGE_MS),safe).snapshot.rows).toHaveLength(1);
  const expired=nextCboeCache(old,empty(MAX_CACHE_AGE_MS+1),safe);
  expect(expired.snapshot.rows).toEqual([]);expect(expired.latestEmptyCheck).toBeNull();
 });
 it('does not fabricate a first populated snapshot or retain after a revision risk',()=>{
  expect(nextCboeCache(null,empty(),safe).snapshot.rows).toEqual([]);
  expect(nextCboeCache(parseCboeCache(fixture()),empty(),{...safe,safeEmptyWindow:false}).snapshot.rows).toEqual([]);
  expect(nextCboeCache(parseCboeCache(fixture()),empty(),{...safe,reportedTradeKeys:[tradeKey(fixture().rows[0])]}).snapshot.rows).toEqual([]);
 });
 it('new qualifying prices replace the retained snapshot rather than merge universes',()=>{
  const old=nextCboeCache(parseCboeCache(fixture()),empty(),safe),fresh={...fixture(),fetchedAt:empty(120_000).fetchedAt};
  const result=nextCboeCache(old,fresh);expect(result.snapshot).toEqual(fresh);expect(result.latestEmptyCheck).toBeNull();
 });
 it('fails schema validation on a claimed populated empty check and a wrong stale state',()=>{
  const cache=nextCboeCache(parseCboeCache(fixture()),empty(),safe);
  expect(cacheSchema.safeParse({...cache,latestEmptyCheck:fixture()}).success).toBe(false);
  const response={...reply(),latest_empty_check:empty()};expect(replySchema.safeParse(response).success).toBe(false);
  response.status.state='stale';expect(replySchema.safeParse(response).success).toBe(true);
 });
 it('drops optional retention when its total envelope would exceed the existing payload cap',()=>{
  const old=parseCboeCache(fixture());
  old.snapshot.rows[0].tradeId='X'.repeat(MAX_SNAPSHOT_CHARS-JSON.stringify(old).length-10);
  expect(JSON.stringify(old).length).toBeLessThan(MAX_SNAPSHOT_CHARS);
  const result=nextCboeCache(old,empty(),safe);expect(result.snapshot.rows).toEqual([]);expect(result.latestEmptyCheck).toBeNull();expect(JSON.stringify(result).length).toBeLessThan(MAX_SNAPSHOT_CHARS);
 });
 it('keeps a newer owned cache unchanged when an earlier inspection missed its latest check',()=>{
  const check={...empty(),sampledFiles:['eqt_trade_BATE_20261105_1201.csv'],windowStart:'2026-11-05T12:01:00.000Z',windowEnd:'2026-11-05T12:02:00.000Z',latestPublicationTime:'2026-11-05T12:01:00.123789Z'};
  const old=nextCboeCache(parseCboeCache(fixture()),check,safe);
  expect(nextCboeCache(old,empty(120_000),safe)).toEqual(old);
 });
 it('never resurrects priced rows after clearing them for a risky empty check',()=>{
  const cleared=nextCboeCache(parseCboeCache(fixture()),empty(),{...safe,safeEmptyWindow:false});
  expect(nextCboeCache(cleared,empty(120_000),safe).snapshot.rows).toEqual([]);
 });
});
