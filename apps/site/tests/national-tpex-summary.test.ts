import {describe,expect,it} from 'vitest';
import {parseTpexSummary,tpexSummarySnapshotSchema,TPEX_SUMMARY_URL,TPEX_SUMMARY_DATASET,TPEX_SUMMARY_LICENSE} from '../lib/national/tpex-summary';

const START='2026-11-05T09:00:00.000Z',FETCHED='2026-11-05T09:00:01.000Z';
// All amounts are synthetic. Nonzero foreign dealers detect accidental double counting.
const row=(Investor:string,buy:number,sell:number)=>({Date:'1151105',Investor,PurchaseAmount:String(buy),SaleAmount:String(sell),Net:String(buy-sell)});
const fixture=()=>[
 row('外資及陸資合計',110,60),row('　外資及陸資(不含自營商)',100,40),
 row('　外資自營商',10,20),row('投信',30,45),row('自營商合計',60,90),
 row('　自營商(自行買賣)',20,30),row('　自營商(避險)',40,60),row('三大法人合計*',190,175),
];
const parse=(payload:unknown=fixture(),start=START,fetched=FETCHED)=>parseTpexSummary(payload,start,fetched);

describe('official TPEx monetary summary parser',()=>{
 it('keeps actual monetary amounts, source dates and own-market scope, without invented capital flow',()=>{
  expect(parse()).toEqual({schema:'tpex-institutional-money/1',source:'TPEx',market:'Taiwan_OTC',unit:'TWD',
   report_date:'2026-11-05',source_released_at:null,acquisition_started_at:START,fetched_at:FETCHED,net_capital_flow:null,
   participants:[{id:'foreign',buy:100,sell:40,net:60},{id:'trust',buy:30,sell:45,net:-15},
    {id:'dealer',buy:60,sell:90,net:-30},{id:'total',buy:190,sell:175,net:15}]});
 });
 it('drops ancillary source lines and does not count foreign dealers twice',()=>{
  const result=parse(fixture().reverse());
  expect(result.participants).toHaveLength(4);
  expect(result.participants[0].buy).toBe(100);
  expect(result.participants[3].net).toBe(15);
 });
 it('accepts genuine zero amounts without treating them as missing',()=>{
  const result=parse(fixture().map(item=>({...item,PurchaseAmount:'0',SaleAmount:'0',Net:'0'})));
  expect(result.participants.every(participant=>participant.net===0)).toBe(true);
 });
 it('uses an explicitly licensed account-free fixed OpenAPI URL with no query or credentials',()=>{
  expect(TPEX_SUMMARY_URL).toBe('https://www.tpex.org.tw/openapi/v1/tpex_3insti_summary');
  expect(TPEX_SUMMARY_DATASET).toBe('https://data.gov.tw/dataset/11743');
  expect(TPEX_SUMMARY_LICENSE).toBe('https://data.gov.tw/license');
 });
 it.each(['','1.5','1e3','01',' 10','10 ','1,000','+1','NaN','Infinity',null,100,'1000000000000000'])('rejects malformed or unbounded amount %s',value=>{
  const data=fixture();Object.assign(data[0],{PurchaseAmount:value});expect(()=>parse(data)).toThrow('invalid_amount');
 });
 it('rejects negative purchases or sales and every row arithmetic mismatch',()=>{
  const data=fixture();data[0].PurchaseAmount='-1';data[0].Net='-61';expect(()=>parse(data)).toThrow('invalid_money_balance');
  for(let i=0;i<8;i++){const other=fixture();other[i].Net='999';expect(()=>parse(other)).toThrow('invalid_money_balance');}
 });
 it.each([0,4,7])('validates source subtotals and total row %s',index=>{
  const data=fixture();data[index].PurchaseAmount=String(Number(data[index].PurchaseAmount)+1);
  data[index].Net=String(Number(data[index].Net)+1);expect(()=>parse(data)).toThrow('invalid_summary_balance');
 });
 it('rejects duplicate, missing and unknown investor classes instead of guessing',()=>{
  const data=fixture();data[1]={...data[0]};expect(()=>parse(data)).toThrow('duplicate_investor');
  expect(()=>parse(fixture().slice(0,7))).toThrow('invalid_row_count');
  const unknown=fixture();unknown[1].Investor='A new investor';expect(()=>parse(unknown)).toThrow('unknown_investor');
 });
 it.each([[],{},null,'html',Array(9).fill({})])('rejects invalid payload %s',payload=>expect(()=>parse(payload)).toThrow());
 it.each(['1150230','1151301','20261105','115110','bad'])('rejects invalid ROC date %s',value=>{
  const data=fixture();data[0].Date=value;expect(()=>parse(data)).toThrow('invalid_report_date');
 });
 it('rejects mixed report dates, future dates, malformed timestamps and backwards acquisition times',()=>{
  const mixed=fixture();mixed[0].Date='1151104';expect(()=>parse(mixed)).toThrow('report_date_mismatch');
  const future=fixture().map(item=>({...item,Date:'1151106'}));expect(()=>parse(future)).toThrow('invalid_snapshot');
  expect(()=>parse(fixture(),'bad')).toThrow('invalid_snapshot');
  expect(()=>parse(fixture(),FETCHED,START)).toThrow('invalid_snapshot');
 });
 it('checks future date against Taipei calendar date, not the UTC day',()=>{
  const today=fixture().map(item=>({...item,Date:'1151106'}));
  expect(parse(today,'2026-11-05T16:00:00Z','2026-11-05T16:00:01Z').report_date).toBe('2026-11-06');
 });
 it('revalidates cached identities, class uniqueness, scope, units and prohibited capital flow',()=>{
  const result=parse();
  for(const change of [{unit:'shares'},{market:'Taiwan'},{net_capital_flow:15},{source_released_at:FETCHED},{fake:0}]){
   expect(tpexSummarySnapshotSchema.safeParse({...result,...change}).success).toBe(false);
  }
  const dup=parse();dup.participants[1]={...dup.participants[0]};expect(tpexSummarySnapshotSchema.safeParse(dup).success).toBe(false);
  const changed=parse();changed.participants[3].buy++;changed.participants[3].net++;
  expect(tpexSummarySnapshotSchema.safeParse(changed).success).toBe(false);
 });
});
