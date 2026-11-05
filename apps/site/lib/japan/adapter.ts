import {ReportError} from '../reports/types';
import {snapshotSchema,type JapanMofSnapshot} from './model';
function fail(code:string):never{throw new ReportError(code);}
/** RFC4180 subset: quoted embedded newlines, doubled quotes, exactly 23 columns. */
export function parseCSV(text:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)fail('invalid_csv');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){row.push(field);field='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.length!==23)fail('invalid_columns');rows.push(row);row=[];if(rows.length>5000)fail('row_budget');}continue;}
  if(closed)fail('invalid_csv');field+=c;
 }
 if(quoted)fail('invalid_csv');if(field||closed||row.length){row.push(field);if(row.length!==23)fail('invalid_columns');rows.push(row);}return rows;
}
function iso(y:string,m:string,d:string){const s=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;if(!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)fail('invalid_period');return s;}
export function parsePeriod(raw:string){const s=raw.normalize('NFKC').replace(/\s/g,'');const m=/^(\d{4})\.(\d{1,2})\.(\d{1,2})[~〜～](?:(\d{4})\.)?(\d{1,2})\.(\d{1,2})$/.exec(s);if(!m)fail('invalid_period');const start=iso(m[1],m[2],m[3]),end=iso(m[4]??m[1],m[5],m[6]);if(Date.parse(end)-Date.parse(start)!==6*86_400_000||new Date(start).getUTCDay()!==0)fail('invalid_period');return {start,end};}
function number(raw:string){const s=raw.trim();if(!/^-?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(s))fail('invalid_amount');const n=Number(s.replaceAll(',',''));if(!Number.isSafeInteger(n)||Math.abs(n)>90_071_992)fail('invalid_amount');return n;}
export function parseJapanMof(raw:unknown,started:string,fetched:string):JapanMofSnapshot{
 if(typeof raw!=='string')fail('invalid_source_schema');const rows=parseCSV(raw);
 const eq=(r:number,c:number,value:string)=>{if(rows[r]?.[c].trim()!==value)fail('invalid_headers');};
 eq(1,0,'International Transactions in Securities (Weekly; based on reports from designated major investors)');eq(4,19,'Unit: 100 million Yen');eq(8,12,'2. Portfolio Investment Liabilities');
 for(const [col,label] of [[12,'Equity and investment fund shares'],[15,'Long-term debt securities'],[18,'Subtotal'],[19,'Short-term debt securities'],[22,'Total']] as const)eq(11,col,label);
 for(const col of [12,15,19])for(const [offset,label] of ['Acquisition','Disposition','Net'].entries())eq(13,col+offset,label);eq(13,18,'Net');eq(13,22,'Net');
 const update=/^Final Update\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*,\s*(\d{4})$/.exec(rows[1][19].trim());if(!update)fail('invalid_updated_date');const months=['January','February','March','April','May','June','July','August','September','October','November','December'];const updated=iso(update[3],String(months.indexOf(update[1])+1),update[2]);
 let latest:{row:string[];start:string;end:string}|null=null,previous:string|null=null,index=14;
 for(;index<rows.length&&!rows[index].every(v=>v==='');index++){const row=rows[index],period=parsePeriod(row[0]);if(previous&&Date.parse(period.start)-Date.parse(previous)!==86_400_000)fail('period_gap');previous=period.end;latest={row,...period};}
 if(!latest||latest.start<'2014-01-01')fail('missing_report');
 const footer=rows.slice(index).map(r=>r.join(' ')).join('\n');if(!footer.includes('Totals may not add due to rounding.')||!footer.includes('net acquisition with a plus sign')||!footer.includes('starting from January 2014.'))fail('invalid_notes');
 // Only the most recent post-2014 observation is retained. Do not sum subtotal twice.
 const assets=([['equity_funds',12],['long_term_debt',15],['short_term_debt',19]] as const).map(([id,c])=>({id,acquisitions:number(latest.row[c]),dispositions:number(latest.row[c+1]),net:number(latest.row[c+2])}));
 if(Math.abs(assets[0].net+assets[1].net-number(latest.row[18]))>1)fail('invalid_subtotal');
 const result=snapshotSchema.safeParse({schema:'japan-mof-weekly/1',source:'Japan_MOF',unit:'JPY_100_million',report_date:latest.end,report_start:latest.start,report_end:latest.end,updated_date:updated,source_released_at:null,acquisition_started_at:started,fetched_at:fetched,assets,total_net:number(latest.row[22]),coverage:'nonresident_transactions_via_designated_major_institutions'});if(!result.success)fail('invalid_snapshot');return result.data;
}
