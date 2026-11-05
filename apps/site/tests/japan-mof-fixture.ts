/** Source-shaped ASCII fixture with exclusively synthetic amounts. */
export function mofFixture(){
 const rows=Array.from({length:14},()=>Array<string>(23).fill(''));
 rows[1][0]='International Transactions in Securities (Weekly; based on reports from designated major investors)';rows[1][19]='Final Update October 29 , 2026';rows[4][19]='Unit: 100 million Yen';rows[8][12]='2. Portfolio Investment Liabilities';
 for(const [c,label] of [[12,'Equity and investment fund shares'],[15,'Long-term debt securities'],[18,'Subtotal'],[19,'Short-term debt securities'],[22,'Total']] as const)rows[11][c]=label;
 for(const c of [12,15,19])['Acquisition','Disposition','Net'].forEach((v,i)=>rows[13][c+i]=v);rows[13][18]=rows[13][22]='Net';
 const row=Array<string>(23).fill('');row[0]='2026.10.18~10.24';[100,40,60,25,50,-25,35,10,20,-10,25].forEach((n,i)=>row[12+i]=String(n));rows.push(row,Array<string>(23).fill(''));
 for(const text of ['Totals may not add due to rounding.','net acquisition with a plus sign','starting from January 2014.']){const r=Array<string>(23).fill('');r[1]=text;rows.push(r);}
 return rows;
}
export const csv=(rows=mofFixture())=>rows.map(r=>r.map(v=>/[",\r\n]/.test(v)?`"${v.replaceAll('"','""')}"`:v).join(',')).join('\r\n');
