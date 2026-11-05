import type {EvidenceSnapshot} from './model';

export const SNAPSHOT_CHECK_INTERVAL_MS = 60_000;
export const ASHARE_CALENDAR = {
 year: 2026,
 holidaySource: 'https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml',
 hoursSource: 'https://english.sse.com.cn/start/trading/schedule/',
} as const;

// Inclusive exchange closures from the SSE notice, not the government workday
// calendar. Weekend make-up workdays remain non-trading days.
const closures = [
 ['2026-01-01', '2026-01-03', '元旦'],
 ['2026-02-15', '2026-02-23', '春节'],
 ['2026-04-04', '2026-04-06', '清明节'],
 ['2026-05-01', '2026-05-05', '劳动节'],
 ['2026-06-19', '2026-06-21', '端午节'],
 ['2026-09-25', '2026-09-27', '中秋节'],
 ['2026-10-01', '2026-10-07', '国庆节'],
] as const;

export type SessionPhase = 'unknown' | 'holiday' | 'weekend' | 'pre_open' |
 'opening_auction' | 'opening_break' | 'morning' | 'lunch' | 'afternoon' |
 'closing_auction' | 'closed';
export type AshareSession = {
 phase: SessionPhase;
 label: string;
 localDate: string | null;
 localTime: string | null;
 calendarCovered: boolean;
};

/** UTC+8 calendar clock only, never evidence of provider freshness or actual
 * exchange operation. Unscheduled closures and individual suspensions are unknown. */
export function getAshareSession(nowMs: number | null): AshareSession {
 if (nowMs === null || !Number.isFinite(nowMs))
  return {phase:'unknown', label:'等待设备时间', localDate:null, localTime:null, calendarCovered:false};
 const local = new Date(nowMs + 8 * 60 * 60 * 1000);
 if (!Number.isFinite(local.getTime()))
  return {phase:'unknown', label:'设备时间无法识别', localDate:null, localTime:null, calendarCovered:false};
 const iso = local.toISOString();
 const base = {localDate:iso.slice(0,10), localTime:iso.slice(11,16), calendarCovered:local.getUTCFullYear() === ASHARE_CALENDAR.year};
 // Never extrapolate a previous year's holiday list into a new year.
 if (!base.calendarCovered) return {...base, phase:'unknown', label:'交易日历未覆盖，开休市未知'};
 const holiday = closures.find(([from,to])=>base.localDate >= from && base.localDate <= to);
 if (holiday) return {...base, phase:'holiday', label:`${holiday[2]}休市`};
 if ([0,6].includes(local.getUTCDay())) return {...base, phase:'weekend', label:'周末休市'};
 const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
 const [phase,label]: [SessionPhase,string] = minute < 555 ? ['pre_open','盘前，尚未开市'] :
  minute < 565 ? ['opening_auction','开盘集合竞价时段'] :
  minute < 570 ? ['opening_break','集合竞价后，连续竞价未开始'] :
  minute < 690 ? ['morning','上午连续竞价时段'] :
  minute < 780 ? ['lunch','午间休市'] :
  minute < 897 ? ['afternoon','下午连续竞价时段'] :
  minute < 900 ? ['closing_auction','收盘集合竞价时段'] : ['closed','已收市'];
 return {...base, phase, label};
}

export function formatShanghaiTimestamp(timestamp: string): string | null {
 const ms = Date.parse(timestamp);
 if (!Number.isFinite(ms)) return null;
 const local = new Date(ms + 8 * 60 * 60 * 1000);
 if (!Number.isFinite(local.getTime())) return null;
 return local.toISOString().slice(0,19).replace('T',' ');
}

export type AcquisitionStatus = 'absent' | 'clock_unknown' | 'clock_mismatch' |
 'refresh_error' | 'server_stale' | 'expired' | 'recent';
export type AcquisitionTiming = {status:AcquisitionStatus; label:string; ageMs:number | null};
type AcquisitionSnapshot = Pick<EvidenceSnapshot,'fetched_at' | 'stale' | 'has_error'>;

/** Fresh acquisition does not imply fresh observations: current source contracts
 * deliberately leave source_observed_at, trade_date and delay unknown. */
export function getAcquisitionTiming(snapshot: AcquisitionSnapshot | null, nowMs: number | null): AcquisitionTiming {
 if (!snapshot) return {status:'absent', label:'尚无完整有效快照', ageMs:null};
 const fetchedMs = Date.parse(snapshot.fetched_at);
 const ageMs = nowMs === null || !Number.isFinite(nowMs) || !Number.isFinite(fetchedMs) ? null : nowMs - fetchedMs;
 if (snapshot.has_error) return {status:'refresh_error', label:'刷新失败，保留带标记的旧快照', ageMs};
 if (snapshot.stale) return {status:'server_stale', label:'服务器已标记缓存陈旧', ageMs};
 if (ageMs === null) return {status:'clock_unknown', label:'采集年龄暂不可判断', ageMs};
 if (ageMs < 0) return {status:'clock_mismatch', label:'设备时间早于采集时间，年龄未知', ageMs:null};
 if (ageMs >= SNAPSHOT_CHECK_INTERVAL_MS) return {status:'expired', label:'距采集已至少 60 秒，等待刷新确认', ageMs};
 return {status:'recent', label:'距采集不足 60 秒，行情新旧仍未知', ageMs};
}

export function acquisitionAgeLabel(ageMs: number | null): string | null {
 if (ageMs === null || !Number.isFinite(ageMs) || ageMs < 0) return null;
 const minutes = Math.floor(ageMs / 60_000);
 return minutes === 0 ? '不足 1 分钟前' : minutes < 60 ? `${minutes} 分钟前` :
  minutes < 1440 ? `${Math.floor(minutes/60)} 小时前` : `${Math.floor(minutes/1440)} 天前`;
}
