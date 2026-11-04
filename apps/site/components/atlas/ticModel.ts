export type TicFlow={record_id:string;foreign_economy_iso3:string;foreign_economy_name:string;treasury_country_code:string;issuer_economy_iso3:'USA';net_foreign_purchases_usd:number;period:string;source_id:string};
export type TicSnapshot={version:string;concept:'reported_net_transactions';asset_class:'equity';frequency:'monthly';is_live:false;period:string;source_id:string;source_url:string;source_field:'for_lt_eqty_net';source_unit:'USD millions';output_unit:'USD';observation_release_date:string|null;release_url:string|null;source_revision_published_at:string|null;retrieved_at:string;raw_sha256:string;adapter_version:string;geography_version:string;excluded_records:Record<string,number>;country_flows:TicFlow[];grand_total_net_foreign_purchases_usd:number|null;direction_note:string;coverage_note:string;license_note:string;rights_url:string};
export type TicStatus={state:'available'|'unavailable'|'stale';last_checked_at:string|null;error:string|null};
export function validateTic(value:unknown):TicSnapshot{
 const s=value as TicSnapshot;
 if(!s||s.concept!=='reported_net_transactions'||s.asset_class!=='equity'||s.frequency!=='monthly'||s.is_live!==false||s.source_unit!=='USD millions'||s.output_unit!=='USD'||s.source_field!=='for_lt_eqty_net'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(s.period)||!Array.isArray(s.country_flows))throw new Error('Unsupported TIC transaction contract. Values are hidden.');
 const seen=new Set<string>();
 for(const row of s.country_flows){if(!Number.isSafeInteger(row.net_foreign_purchases_usd)||row.issuer_economy_iso3!=='USA'||row.foreign_economy_iso3==='USA'||!/^[A-Z]{3}$/.test(row.foreign_economy_iso3)||row.period!==s.period||seen.has(row.foreign_economy_iso3))throw new Error('Invalid or duplicate TIC country observation.');seen.add(row.foreign_economy_iso3)}
 if(s.grand_total_net_foreign_purchases_usd!==null&&!Number.isSafeInteger(s.grand_total_net_foreign_purchases_usd))throw new Error('Invalid TIC published grand total.');
 return s;
}
export function signedMillions(value:number|null|undefined){return value==null?'—':new Intl.NumberFormat('en-US',{signDisplay:'exceptZero',maximumFractionDigits:6}).format(value/1_000_000)}
export function flowDirection(value:number){return value>0?'净买入美国股权 · Net purchases':value<0?'净卖出美国股权 · Net sales':'报告净额为零 · Reported zero'}
export function selectTicRows(s:TicSnapshot|null,period:string,country:string,sign:string){return(s?.country_flows||[]).filter(r=>(!period||r.period===period)&&(!country||country==='USA'||r.foreign_economy_iso3===country)&&(sign==='all'||(sign==='positive'?r.net_foreign_purchases_usd>0:sign==='negative'?r.net_foreign_purchases_usd<0:r.net_foreign_purchases_usd===0))).sort((a,b)=>Math.abs(b.net_foreign_purchases_usd)-Math.abs(a.net_foreign_purchases_usd))}
