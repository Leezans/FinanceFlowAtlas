import {describe,it,expect} from 'vitest';
import {parseCboeTrades,projectCboeQuotes} from '../lib/cboe/adapter';
import {snapshotSchema} from '../lib/cboe/model';
const file='eqt_trade_BATE_20261105_1200.csv';
const line=(overrides:Partial<Record<number,string>>={})=>['2026-11-05 12:00:00.123456','GB0000000001','12.3456','GBP','MONE','10','BATE','CLOB','2026-11-05 12:00:00.123789','BATE','ABC001','""'].map((v,i)=>overrides[i]??v).join(',');
const parsed=(text:string)=>parseCboeTrades(text,file);
describe('Cboe delayed trade parser',()=>{
 it('parses twelve-field on-exchange records and preserves microseconds',()=>{const p=parsed(line());expect(p.rawRows).toBe(1);expect(p.rejectedRows).toBe(0);expect(p.events[0]).toMatchObject({price:'12.3456',tradeTime:'2026-11-05T12:00:00.123456Z',publicationTime:'2026-11-05T12:00:00.123789Z',sourceFile:file,eligible:true});});
 it.each(['BATE','BATD','BATP'])('accepts approved execution %s',(mic)=>{expect(parsed(line({6:mic,7:mic==='BATP'?'PATS':'CLOB'})).events[0].eligible).toBe(true);});
 it('permits ALGO only, excludes all other flags and offbook venues',()=>{expect(parsed(line({11:'"ALGO"'})).events[0].eligible).toBe(true);for(const flags of ['NETW','NPFT','BENC,NETW','LRGS','ILQD','AMND','CANC','UNKN'])expect(parsed(line({11:`"${flags}"`})).events[0].eligible).toBe(false);expect(parsed(line({6:'BATF',7:'OTHR'})).events[0].eligible).toBe(false);});
 it('retains exact currencies without scaling',()=>{expect(projectCboeQuotes(parsed(line({3:'GBX'})).events)[0]).toMatchObject({currency:'GBX',price:'12.3456'});});
 it('rejects invalid numeric forms, timestamps and field counts',()=>{for(const change of [{2:'NaN'},{2:'1e3'},{2:'0'},{2:'-1'},{5:'Infinity'},{0:'2026-02-30 12:00:00.000000'},{0:'2026-11-05 12:00:01.000000'},{8:'2026-11-05 12:00:00'},{1:'not-isin'},{9:'???'}])expect(parsed(line(change)).rejectedRows).toBe(1);expect(parsed(line()+',extra').rejectedRows).toBe(1);});
 it('preserves exact source prices up to 18 characters without numeric conversion',()=>{
  for(const price of ['9007199254740993','0.0000000000001','1.1234567890123','1234.123456789012','999999999999999999','00012.340000000000'])expect(parsed(line({2:price})).events[0]?.price,price).toBe(price);
  for(const price of ['9999999999999999999','0.00000000000000001','0','0.000','1e3','NaN','Infinity','-1','1.','.1'])expect(parsed(line({2:price})).rejectedRows,price).toBe(1);
  expect(parsed(line({2:'12.34',5:'0.0000000000001'})).events[0].quantity).toBe(1e-13);
 });
 it('fails closed on malformed quoting',()=>{expect(()=>parsed(line({11:'"bad'}))).toThrow('cboe_invalid_csv');});
 it('deduplicates source overlap and chooses latest trade, not latest publication',()=>{const old=line({10:'OLD',8:'2026-11-05 12:00:02.000000'}), newer=line({0:'2026-11-05 12:00:01.000000',8:'2026-11-05 12:00:01.000001',2:'13',10:'NEW'});const q=projectCboeQuotes(parsed(old+'\r\n'+newer+'\n'+newer).events);expect(q).toHaveLength(1);expect(q[0].price).toBe('13');});
 it('suppresses cancelled/amended instruments even when originals are outside window',()=>{for(const flag of ['CANC','CNCL','AMND'])expect(projectCboeQuotes(parsed(line()+'\n'+line({10:'OTHER',11:`"${flag}"`,2:'',5:''})).events)).toEqual([]);});
 it('treats zero cancellation price as unavailable, never a displayed trade',()=>{const events=parsed(line()+'\n'+line({11:'"CANC"',2:'0.000',5:'0'})).events;expect(events).toHaveLength(2);expect(events[1].price).toBeNull();expect(projectCboeQuotes(events)).toEqual([]);});
 it('rejects nonblank malformed cancellation numbers',()=>{for(const flag of ['CANC','AMND'])for(const value of ['NaN','Infinity','oops','-1'])expect(parsed(line({11:`"${flag}"`,2:value})).rejectedRows).toBe(1);});
 it('suppresses conflicting duplicate trade IDs',()=>{expect(projectCboeQuotes(parsed(line()+'\n'+line({2:'99'})).events)).toEqual([]);});
 it('does not treat a filename difference as conflicting duplicate',()=>{expect(projectCboeQuotes([...parsed(line()).events,...parseCboeTrades(line(),'eqt_trade_BATE_20261105_1201.csv').events])).toHaveLength(1);});
 it('skips only an exact first-row source header',()=>{const header='UpdateTime,InstrumentID,Price,PriceCurrency,PriceNotation,Quantity,VenueOfExecution,TradingSystem,PublicationTime,VenueOfPublication,TransactionID,Flags';expect(parsed(header+'\n'+line())).toMatchObject({rawRows:1,skippedRows:1,rejectedRows:0});for(const fake of ['trade_time,malformed,cancellation','Trading date and time,malformed',header+',extra',header.replace('Flags','flags')])expect(parsed(fake)).toMatchObject({rawRows:1,skippedRows:0,rejectedRows:1});expect(parsed(line()+'\n'+header)).toMatchObject({rawRows:2,skippedRows:0,rejectedRows:1});});
 it('returns a truly empty file as empty',()=>{expect(parsed('')).toEqual({events:[],rejectedRows:0,skippedRows:0,rawRows:0});});
});
const snapshot=()=>({schema:'cboe-delayed/1',source:'Cboe Europe BXE',sourceDelaySeconds:900,instrumentScope:'equities_and_etfs',venueScope:'BATE/BATD/BATP',frequency:'15_minute_delayed',acquisitionStartedAt:'2026-11-05T12:16:00Z',fetchedAt:'2026-11-05T12:16:01Z',sampledFiles:[file],windowStart:'2026-11-05T12:00:00Z',windowEnd:'2026-11-05T12:01:00Z',latestPublicationTime:'2026-11-05T12:00:00.123789Z',coverage:{rawRows:1,rejectedRows:0,qualifiedRows:1},rows:projectCboeQuotes(parsed(line()).events),netCapitalFlow:null});
describe('Cboe snapshot schema',()=>{
 it('accepts legitimate and empty windows',()=>{expect(snapshotSchema.safeParse(snapshot()).success).toBe(true);expect(snapshotSchema.safeParse({...snapshot(),rows:[],latestPublicationTime:null,coverage:{rawRows:0,rejectedRows:0,qualifiedRows:0}}).success).toBe(true);});
 it('enforces the full delay without discarding submillisecond source precision',()=>{expect(snapshotSchema.safeParse({...snapshot(),acquisitionStartedAt:'2026-11-05T12:15:00.123Z'}).success).toBe(false);expect(snapshotSchema.safeParse({...snapshot(),acquisitionStartedAt:'2026-11-05T12:15:00.124Z'}).success).toBe(true);});
 it('rejects normalized impossible calendar dates in persisted source timestamps',()=>{
  for(const field of ['tradeTime','publicationTime'])expect(snapshotSchema.safeParse({...snapshot(),rows:[{...snapshot().rows[0],[field]:'2026-02-30T12:00:00.123789Z'}]}).success).toBe(false);
  expect(snapshotSchema.safeParse({...snapshot(),latestPublicationTime:'2026-02-30T12:00:00.123789Z'}).success).toBe(false);
 });
 it('rejects cached rows later than latest publication within the same millisecond',()=>{
  expect(snapshotSchema.safeParse({...snapshot(),latestPublicationTime:'2026-11-05T12:00:00.123000Z'}).success).toBe(false);
  expect(snapshotSchema.safeParse({...snapshot(),latestPublicationTime:'2026-11-05T12:00:00.123000Z',acquisitionStartedAt:'2026-11-05T12:15:00.123Z'}).success).toBe(false);
 });
 it('compares source microseconds against exact UTC-normalized acquisition cutoffs',()=>{
  for(const acquisitionStartedAt of ['2026-11-05T12:15:00.123788Z','2026-11-05T13:15:00.123788+01:00'])expect(snapshotSchema.safeParse({...snapshot(),acquisitionStartedAt}).success).toBe(false);
  for(const acquisitionStartedAt of ['2026-11-05T12:15:00.123789Z','2026-11-05T13:15:00.123789+01:00'])expect(snapshotSchema.safeParse({...snapshot(),acquisitionStartedAt}).success).toBe(true);
  expect(snapshotSchema.safeParse({...snapshot(),acquisitionStartedAt:'2026-11-05T12:15:00.1237891Z'}).success).toBe(false);
 });
 it('requires exact positive cached decimal strings with at most 18 characters',()=>{
  for(const price of [9007199254740993,1e-13,12.34,'9999999999999999999','0.00000000000000001','0','0.000','1e3','NaN','Infinity','-1','1.','.1'])expect(snapshotSchema.safeParse({...snapshot(),rows:[{...snapshot().rows[0],price}]}).success,String(price)).toBe(false);
  for(const price of ['9007199254740993','0.0000000000001','1.1234567890123','999999999999999999','12.34000000'])expect(snapshotSchema.safeParse({...snapshot(),rows:[{...snapshot().rows[0],price}]}).success,price).toBe(true);
 });
 it('rejects inferred metadata, bad coverage, duplicate quotes, absent files and timestamps',()=>{for(const change of [{country:'GB'},{industry:'Finance'},{coverage:{rawRows:0,rejectedRows:1,qualifiedRows:1}},{rows:[...snapshot().rows,...snapshot().rows]},{sampledFiles:['bad.csv']},{windowEnd:'2026-11-05T11:59:00Z'},{latestPublicationTime:null},{latestPublicationTime:'2027-01-01T00:00:00Z'}])expect(snapshotSchema.safeParse({...snapshot(),...change}).success).toBe(false);});
});
