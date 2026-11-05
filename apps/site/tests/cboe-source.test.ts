import {describe,it,expect,vi} from 'vitest';
import {fetchCboeSnapshot,fetchCboeCollection,selectFiles,sourceUrl} from '../lib/cboe/source';
const NOW=Date.parse('2026-11-05T12:20:00Z');
const file=(minute='1200')=>({filename:`eqt_trade_BATE_20261105_${minute}.csv`,serveUrl:`https://cdn.cboe.com/data/europe/equities/delayed_data/eqt_trade_BATE/synthetic/minute/eqt_trade_BATE_20261105_${minute}.csv`});
const map=(rows=[file()])=>({daily:[],minute:rows});
const row=(minute='12:00',flags='')=>`2026-11-05 ${minute}:00.123456,GB0000000001,12.3456,GBP,MONE,10,BATE,CLOB,2026-11-05 ${minute}:00.123789,BATE,ABC${minute.replace(':','')},"${flags}"\n`;
const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
const csv=(v:string)=>new Response(v,{headers:{'content-type':'text/csv'}});
describe('Cboe file selection',()=>{
 it('selects latest five declared files ascending, with no bulk daily fetch',()=>{const files=selectFiles(map(['1150','1151','1154','1157','1200','1201'].map(file)),NOW);expect(files.map(f=>f.filename.slice(-8,-4))).toEqual(['1151','1154','1157','1200','1201']);});
 it.each([
 {...file(),serveUrl:'https://evil.invalid/test.csv'},
 {...file(),serveUrl:file().serveUrl+'?token=bad'},
 {...file(),serveUrl:file().serveUrl.replace('synthetic','../../bad')},
 {...file(),serveUrl:file().serveUrl.replace('https://','http://')},
 {...file(),serveUrl:file().serveUrl.replace('cdn.cboe.com','user@cdn.cboe.com')},
 {...file(),filename:'eqt_trade_BATE_20261104_1200.csv'},
 file('1265'),file('1221'),
 ])('rejects untrusted/mismatched file references',f=>expect(()=>selectFiles(map([f]),NOW)).toThrow());
 it('rejects duplicate files, malformed map and no files',()=>{expect(()=>selectFiles(map([file(),file()]),NOW)).toThrow();expect(()=>selectFiles({minute:[]},NOW)).toThrow();expect(()=>selectFiles(map([]),NOW)).toThrow('no_published_files');});
});
describe('Cboe bounded source cohort',()=>{
 it('gets map and bounded CSV with no credentials and keeps source times',async()=>{const fetcher=vi.fn<typeof fetch>(async url=>String(url)===sourceUrl(NOW)?json(map()):csv(row()));const s=await fetchCboeSnapshot(fetcher,NOW,()=>NOW+500,new AbortController().signal);expect(s.rows).toHaveLength(1);expect(s.rows[0].publicationTime).toBe('2026-11-05T12:00:00.123789Z');expect(s.fetchedAt).toBe('2026-11-05T12:20:00.500Z');expect(s.netCapitalFlow).toBeNull();for(const call of fetcher.mock.calls)expect(call[1]).toMatchObject({credentials:'omit',redirect:'manual',cache:'no-store'});});
 it('records empty eligible windows without presenting late NPFT prices',async()=>{const fetcher=vi.fn<typeof fetch>(async url=>String(url)===sourceUrl(NOW)?json(map()):csv(row('12:00','NPFT,NETW')));const s=await fetchCboeSnapshot(fetcher,NOW,()=>NOW,new AbortController().signal);expect(s.rows).toEqual([]);expect(s.coverage).toEqual({rawRows:1,rejectedRows:1,qualifiedRows:0});expect(s.latestPublicationTime).not.toBeNull();});
 it.each([['NPFT,NETW',true],['CANC',false],['AMND',false],['ABCD',false],['',false]])('retention safety for flags %s is explicit',async(flags,safe)=>{
  const fetcher=vi.fn<typeof fetch>(async url=>String(url)===sourceUrl(NOW)?json(map()):csv(row('12:00',String(flags))));
  const result=await fetchCboeCollection(fetcher,NOW,()=>NOW,new AbortController().signal);
  expect(result.retention.safeEmptyWindow).toBe(safe);expect(result.retention.reportedTradeKeys).toEqual(['BATE:2026-11-05:ABC1200']);
 });
 it('fails entire cohort on malformed source rows',async()=>{const fetcher=vi.fn<typeof fetch>(async url=>String(url)===sourceUrl(NOW)?json(map()):csv(row()+'bad,cancel,row\n'));await expect(fetchCboeSnapshot(fetcher,NOW,()=>NOW,new AbortController().signal)).rejects.toThrow('invalid_source_rows');});
 it('fails a source/file minute mismatch and insufficient source delay',async()=>{for(const value of [row('11:59'),row('12:05')]){const fetcher=vi.fn<typeof fetch>(async url=>String(url)===sourceUrl(NOW)?json(map([file(value.includes('12:05')?'1205':'1200')])):csv(value));await expect(fetchCboeSnapshot(fetcher,NOW,()=>NOW,new AbortController().signal)).rejects.toThrow('inconsistent_source_time');}});
 it.each([401,403,406,407,429,451])('stops on %s and makes no next data request',async status=>{const f=vi.fn<typeof fetch>(async()=>new Response('',{status}));await expect(fetchCboeSnapshot(f,NOW,()=>NOW,new AbortController().signal)).rejects.toMatchObject({denied:true});expect(f).toHaveBeenCalledTimes(1);});
 it('rejects redirects, HTML challenges and oversized bodies',async()=>{for(const r of [new Response('',{status:302,headers:{location:'https://other.invalid'}}),new Response('<html>challenge</html>',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'1000001'}})]){await expect(fetchCboeSnapshot(async()=>r,NOW,()=>NOW,new AbortController().signal)).rejects.toThrow();}});
 it('honors Retry-After without retrying',async()=>{const f=vi.fn<typeof fetch>(async()=>new Response('',{status:503,headers:{'retry-after':'3600'}}));await expect(fetchCboeSnapshot(f,NOW,()=>NOW,new AbortController().signal)).rejects.toMatchObject({retryAfterMs:3600000});expect(f).toHaveBeenCalledTimes(1);});
 it('stops before source when already aborted',async()=>{const c=new AbortController();c.abort();const f=vi.fn<typeof fetch>();await expect(fetchCboeSnapshot(f,NOW,()=>NOW,c.signal)).rejects.toThrow('source_aborted');expect(f).not.toHaveBeenCalled();});
});
