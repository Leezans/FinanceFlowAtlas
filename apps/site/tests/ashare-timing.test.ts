import {describe,expect,it} from 'vitest';
import {acquisitionAgeLabel,formatShanghaiTimestamp,getAcquisitionTiming,getAshareSession} from '../components/ashare/timing';

const shanghai = (date:string,time='10:00:00')=>Date.parse(`${date}T${time}+08:00`);
const acquisition = {fetched_at:'2026-11-05T02:00:00Z',stale:false,has_error:false};

describe('published exchange calendar, not a live market feed',()=>{
 it.each([
  ['09:14:59','pre_open'],['09:15:00','opening_auction'],['09:24:59','opening_auction'],
  ['09:25:00','opening_break'],['09:29:59','opening_break'],['09:30:00','morning'],
  ['11:29:59','morning'],['11:30:00','lunch'],['12:59:59','lunch'],
  ['13:00:00','afternoon'],['14:56:59','afternoon'],['14:57:00','closing_auction'],
  ['14:59:59','closing_auction'],['15:00:00','closed'],['23:59:59','closed'],
 ])('classifies 2026-11-05 %s Shanghai as %s', (time,phase)=>{
  expect(getAshareSession(shanghai('2026-11-05',time))).toMatchObject({phase,calendarCovered:true,localDate:'2026-11-05'});
 });
 it.each([
  ['2026-01-01','2026-01-03'],['2026-02-15','2026-02-23'],['2026-04-04','2026-04-06'],
  ['2026-05-01','2026-05-05'],['2026-06-19','2026-06-21'],['2026-09-25','2026-09-27'],['2026-10-01','2026-10-07'],
 ])('includes both boundaries and every day of %s through %s', (from,to)=>{
  for(let date=shanghai(from);date<=shanghai(to);date+=86_400_000)
   expect(getAshareSession(date).phase).toBe('holiday');
 });
 it.each(['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10'])('does not turn make-up working day %s into a trading day',date=>{
  expect(getAshareSession(shanghai(date)).phase).toBe('weekend');
 });
 it.each(['2026-01-05','2026-02-24','2026-04-07','2026-05-06','2026-06-22','2026-09-28','2026-10-08'])('returns regular schedule on reopening day %s',date=>{
  expect(getAshareSession(shanghai(date)).phase).toBe('morning');
 });
 it('uses Shanghai date rather than browser/UTC day at midnight',()=>{
  expect(getAshareSession(Date.parse('2026-11-06T16:00:00Z'))).toMatchObject({localDate:'2026-11-07',localTime:'00:00',phase:'weekend'});
  expect(getAshareSession(Date.parse('2026-11-06T15:59:59Z'))).toMatchObject({localDate:'2026-11-06',phase:'closed'});
 });
 it.each(['2025-12-31','2027-01-04','2027-01-09'])('never extrapolates 2026 holidays into %s',date=>{
  expect(getAshareSession(shanghai(date))).toMatchObject({phase:'unknown',calendarCovered:false,label:'交易日历未覆盖，开休市未知'});
 });
 it.each([null,NaN,Infinity,Number.MAX_VALUE])('handles unavailable/invalid device clock %s without asserting a session',now=>{
  expect(getAshareSession(now)).toMatchObject({phase:'unknown',calendarCovered:false,localDate:null});
 });
});

describe('acquisition age is independent from unknown observation time',()=>{
 const now = Date.parse(acquisition.fetched_at);
 it('distinguishes absent, recent and expired cache at the 60-second boundary',()=>{
  expect(getAcquisitionTiming(null,now).status).toBe('absent');
  expect(getAcquisitionTiming(acquisition,now).status).toBe('recent');
  expect(getAcquisitionTiming(acquisition,now+59_999).status).toBe('recent');
  expect(getAcquisitionTiming(acquisition,now+60_000).status).toBe('expired');
  expect(acquisition).toEqual({fetched_at:'2026-11-05T02:00:00Z',stale:false,has_error:false});
 });
 it('never makes market closure or a new fetch into evidence of source freshness',()=>{
  const closed = shanghai('2026-11-07');
  expect(getAshareSession(closed).phase).toBe('weekend');
  expect(getAcquisitionTiming(acquisition,closed).status).toBe('expired');
  expect(getAcquisitionTiming({...acquisition,fetched_at:new Date(closed).toISOString()},closed).label).toContain('行情新旧仍未知');
 });
 it('keeps server stale/error flags even if the timestamp is recent or clock absent',()=>{
  expect(getAcquisitionTiming({...acquisition,stale:true},now).status).toBe('server_stale');
  expect(getAcquisitionTiming({...acquisition,stale:true,has_error:true},now).status).toBe('refresh_error');
  expect(getAcquisitionTiming({...acquisition,stale:true,has_error:true},null).status).toBe('refresh_error');
 });
 it('does not clamp a future fetched timestamp into a recent cache',()=>{
  expect(getAcquisitionTiming(acquisition,now-1)).toMatchObject({status:'clock_mismatch',ageMs:null});
  expect(getAcquisitionTiming(acquisition,null).status).toBe('clock_unknown');
  expect(getAcquisitionTiming(acquisition,NaN).status).toBe('clock_unknown');
  expect(getAcquisitionTiming({...acquisition,fetched_at:'invalid'},now).status).toBe('clock_unknown');
 });
 it('formats the timestamp in UTC+8 and labels acquisition age without source precision',()=>{
  expect(formatShanghaiTimestamp('2026-11-05T16:01:02Z')).toBe('2026-11-06 00:01:02');
  expect(formatShanghaiTimestamp('2026-11-05T10:00:00+08:00')).toBe('2026-11-05 10:00:00');
  expect(formatShanghaiTimestamp('invalid')).toBeNull();
  expect(formatShanghaiTimestamp('+275760-09-13T00:00:00Z')).toBeNull();
  expect(acquisitionAgeLabel(59_999)).toBe('不足 1 分钟前');
  expect(acquisitionAgeLabel(60_000)).toBe('1 分钟前');
  expect(acquisitionAgeLabel(3_600_000)).toBe('1 小时前');
  expect(acquisitionAgeLabel(86_400_000)).toBe('1 天前');
  for(const value of [null,-1,Infinity])expect(acquisitionAgeLabel(value)).toBeNull();
 });
});
