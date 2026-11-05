import {parseCboeTrades,projectCboeQuotes} from '../lib/cboe/adapter';
import {snapshotSchema} from '../lib/cboe/model';
import {REFRESH_MS,MAX_CACHE_AGE_MS,type CboeReply} from '../lib/cboe/service-model';
export const NOW=Date.parse('2026-11-05T12:20:00.000Z'),ISO=new Date(NOW).toISOString();
export const FILE='eqt_trade_BATE_20261105_1200.csv';
export const LINE='2026-11-05 12:00:00.123456,GB0000000001,12.3456,GBP,MONE,10,BATE,CLOB,2026-11-05 12:00:00.123789,BATE,ABC001,""\n';
export const fixture=()=>snapshotSchema.parse({schema:'cboe-delayed/1',source:'Cboe Europe BXE',sourceDelaySeconds:900,instrumentScope:'equities_and_etfs',venueScope:'BATE/BATD/BATP',frequency:'15_minute_delayed',acquisitionStartedAt:ISO,fetchedAt:ISO,sampledFiles:[FILE],windowStart:'2026-11-05T12:00:00.000Z',windowEnd:'2026-11-05T12:01:00.000Z',latestPublicationTime:'2026-11-05T12:00:00.123789Z',coverage:{rawRows:1,rejectedRows:0,qualifiedRows:1},rows:projectCboeQuotes(parseCboeTrades(LINE,FILE).events),netCapitalFlow:null});
export const reply=():CboeReply=>({snapshot:fixture(),status:{state:'available',error_code:null,last_attempt_at:ISO,fetched_at:ISO,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(NOW+REFRESH_MS).toISOString()}});
