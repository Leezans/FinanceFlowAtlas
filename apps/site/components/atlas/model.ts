export type Country={iso3:string;iso2:string;name:string;numeric:string;coverage:'reporter'|'counterpart_only'|'no_observations';region?:string};
export type Position={reporter_iso3:string;counterpart_iso3:string;value_usd:number;period:string;source_id:string;record_id:string};
export type Source={id:string;name:string;url:string;published_at:string|null;retrieved_at:string|null;status:string;frequency:string};
export type Snapshot={countries:Country[];positions:Position[];sources:Source[];metadata:{as_of:string|null;period:string|null;concept:'position';asset_class:'equity';coverage_note:string;excluded_records?:Record<string,number>;excluded_examples?:Record<string,unknown[]>;adapter_version?:string;unit_verified:boolean;version:string}};
export type Status={state:'ready'|'empty'|'refreshing'|'stale'|'error';last_attempt:string|null;last_success:string|null;next_due:string|null;error:string|null;snapshot_version:string|null};
export const POLL_MS=60_000;
export function validateSnapshot(value:unknown):Snapshot {
 const s=value as Snapshot;
 if(!s||!Array.isArray(s.countries)||!Array.isArray(s.positions)||!Array.isArray(s.sources)||s.metadata?.concept!=='position'||s.metadata.asset_class!=='equity') throw new Error('The API returned an unsupported snapshot.');
 if(s.positions.length&&!s.metadata.unit_verified) throw new Error('Position units have not been verified. Values are hidden.');
 for(const p of s.positions) if(!Number.isFinite(p.value_usd)||p.value_usd<0||!p.reporter_iso3||!p.counterpart_iso3||!p.period) throw new Error('The API returned an invalid position.');
 return s;
}
export function filterPositions(positions:Position[],country:string,direction:string,period:string,region:string,countries:Country[]) {
 const regionIds=new Set(countries.filter(c=>!region||c.region===region).map(c=>c.iso3));
 return positions.filter(p=>(!period||p.period===period)&&(!country||(direction==='held_by'?p.reporter_iso3===country:direction==='issued_by'?p.counterpart_iso3===country:p.reporter_iso3===country||p.counterpart_iso3===country))&&(!region||regionIds.has(p.reporter_iso3)||regionIds.has(p.counterpart_iso3)));
}
export function money(n:number){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(n)}
export function timestamp(s:string|null|undefined){if(!s)return 'Not reported';const date=new Date(s);return Number.isNaN(date.valueOf())?s:date.toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC'}
