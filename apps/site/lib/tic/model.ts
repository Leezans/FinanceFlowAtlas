import {ticSnapshotSchema, type TicSnapshot} from './contract';
export type {TicFlow, TicSnapshot} from './contract';
export type TicStatus={state:'available'|'unavailable'|'stale';last_checked_at:string|null;error:string|null;source_status?:'ready'|'checking'|'cooldown'|'denied'|'uncertain'|'coordination_unavailable';next_retry_at?:string|null};
export function validateTic(value:unknown):TicSnapshot{
 return ticSnapshotSchema.parse(value);
}

export function signedMillions(value:number|null|undefined){return value==null?'—':new Intl.NumberFormat('en-US',{signDisplay:'exceptZero',maximumFractionDigits:6}).format(value/1_000_000)}
export function flowDirection(value:number){return value>0?'净买入美国股权 · Net purchases':value<0?'净卖出美国股权 · Net sales':'报告净额为零 · Reported zero'}
export function selectTicRows(s:TicSnapshot|null,period:string,country:string,sign:string){return(s?.country_flows||[]).filter(r=>(!period||r.period===period)&&(!country||country==='USA'||r.foreign_economy_iso3===country)&&(sign==='all'||(sign==='positive'?r.net_foreign_purchases_usd>0:sign==='negative'?r.net_foreign_purchases_usd<0:r.net_foreign_purchases_usd===0))).sort((a,b)=>Math.abs(b.net_foreign_purchases_usd)-Math.abs(a.net_foreign_purchases_usd))}
