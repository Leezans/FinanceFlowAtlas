import {COUNTRIES} from './geography';
import {readTable, latestPeriod, validateRetrievedAt} from './table';
import {SOURCE_ID, SOURCE_URL, snapshotSchema, type FlowSnapshot, type TicFlow} from './contract';
export {SOURCE_ID, SOURCE_URL, snapshotSchema, type FlowSnapshot} from './contract';
export const ADAPTER_VERSION='tic-equity-v1.1.0';
export async function sha256(bytes:Uint8Array|string){const input=typeof bytes==='string'?new TextEncoder().encode(bytes):bytes;const digest=await crypto.subtle.digest('SHA-256',input as BufferSource);return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')}
/** Canonical encoding matches Python; identity includes this runtime's adapter version. */
function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(', ')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+': '+canonical(v)).join(', ')+'}';return JSON.stringify(value)}
export async function normalize(raw:Uint8Array,period?:string,retrievedAt=new Date().toISOString()):Promise<FlowSnapshot>{
 validateRetrievedAt(retrievedAt);
 const table=readTable(raw);
 period??=latestPeriod(table,retrievedAt);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||period<'2023-02'||period>=new Date(retrievedAt).toISOString().slice(0,7))throw new Error('Unsupported TIC observation month');
 const excluded:Record<string,number>={},records:TicFlow[]=[],seen=new Set<string>();let total:number|null=null;
 const exclude=(reason:string)=>{excluded[reason]=(excluded[reason]||0)+1};
 for(const row of table){
  if(row.date!==period){exclude('other_period');continue}const code=row.country_code;if(seen.has(code))throw new Error('Duplicate country/month observation');seen.add(code);
  const country=COUNTRIES[code];if(!country&&code!=='99996'){exclude('aggregate_or_unmapped_geography');continue}
  if(country&&row.country!==country[0]||code==='99996'&&row.country!=='Grand Total')throw new Error('Country code/name changed; mapping needs review');
  const value=row.for_lt_eqty_net.trim();if(value===''||value==='n.a.'){exclude('missing_transaction_value');continue}if(!/^-?\d+$/.test(value))throw new Error('Unexpected transaction value');
  const usd=Number(value)*1_000_000;if(!Number.isSafeInteger(usd))throw new Error('Transaction exceeds safe numeric precision');if(code==='99996'){total=usd;continue}
  records.push({record_id:`${SOURCE_ID}:${code}:${period}`,foreign_economy_iso3:country[1],foreign_economy_name:country[0],treasury_country_code:code,issuer_economy_iso3:'USA',net_foreign_purchases_usd:usd,period,source_id:SOURCE_ID});
 }
 if(!records.length||total===null)throw new Error('Incomplete transaction month: country observations and published grand total are required');
 const rawHash=await sha256(raw),release=period==='2026-08'?['2026-10-16','https://home.treasury.gov/news/press-releases/sb0662/']:[null,null];
 const version=(await sha256(canonical({raw:rawHash,period,adapter:ADAPTER_VERSION,geography:COUNTRIES,release}))).slice(0,20);
 return snapshotSchema.parse({version,concept:'reported_net_transactions',asset_class:'equity',frequency:'monthly',is_live:false,period,source_id:SOURCE_ID,source_url:SOURCE_URL,source_field:'for_lt_eqty_net',source_unit:'USD millions',output_unit:'USD',observation_release_date:release[0],release_url:release[1],source_revision_published_at:null,retrieved_at:retrievedAt,raw_sha256:rawHash,adapter_version:ADAPTER_VERSION,geography_version:'tic-table1-2026-08-v1',excluded_records:excluded,country_flows:records.sort((a,b)=>a.foreign_economy_iso3.localeCompare(b.foreign_economy_iso3)),grand_total_net_foreign_purchases_usd:total,direction_note:'Positive = foreign net purchases of U.S. equity (money into U.S.); negative = net sales (money out). Do not reverse investor/issuer identities on negative observations.',coverage_note:'U.S.-centric monthly transactions in U.S. corporate equity, including fund shares. Geographic attribution is reported foreign residence, subject to custodial/intermediary bias, not ultimate beneficial ownership or exchange location. Listed country rows are not exhaustive; do not sum them as the world total. Not real time and not comparable to IMF holdings levels.',license_note:'Treasury federal statistical data; source attribution retained. Repository software license does not license provider data or Treasury branding. No third-party materials or blanket worldwide reuse guarantee implied.',rights_url:'https://www.copyright.gov/history/copyright-exhibit/lifecycle/'});
}
