import {describe,it,expect} from 'vitest';
import {parseCvm} from '../lib/cvm/parser';
import {CsvZip} from '../lib/cvm/zip';
import {defaultPeriod,snapshotSchema} from '../lib/cvm/model';
import {zip,row,securities,general,fixtureArchives} from './cvm-fixture';
function run(rows=row(),security=securities,generalCsv=general){const f=fixtureArchives(rows,security,generalCsv);return parseCvm(f.cda,f.fca,'2026-09','2026-11-05T00:00:00Z','2026-11-05T00:01:00Z');}
describe('CVM disclosed monthly fund transactions',()=>{
 it('aggregates exact cents, preserves official sector, absent disclosures null and counts confidentiality without allocating it',async()=>{const s=await run(row()+row('ALPH3','0.01','0','f2')+row('MISS3')+row('ALPH3','100','0','fip','CLASSES - FIP'));expect(s.rows[0].flow).toEqual({buy:2002,sell:1002,net:1000});expect(s.rows[0].industry).toBe('Bancos');expect(s.rows[1].flow).toBeNull();expect(s.counts).toMatchObject({matched_rows:2,unmatched_rows:1,confidential_rows:1,confidential_funds:1,source_rows:3});expect(s.classification_point_in_time).toBe(false);});
 it('quarantines whole stock when an amount is blank',async()=>{const s=await run(row()+row('BETA4')+row('ALPH3','','1','f2'));expect(s.rows[0].flow).toBeNull();expect(s.counts.null_amount_rows).toBe(1);});
 it('quarantines duplicate keys instead of double counting',async()=>{const s=await run(row()+row()+row('BETA4'));expect(s.rows[0].flow).toBeNull();expect(s.counts.duplicate_rows).toBe(1);});
 it('does not infer ticker aliases or use mismatched FCA documents',async()=>{const s=await run(row()+row('BETA4'),securities.replace('1;10;1;2026-01-01;ALPH3','1;99;1;2026-01-01;ALPH3'));expect(s.rows.some(r=>r.code==='ALPH3')).toBe(false);expect(s.counts.ambiguous_rows).toBe(1);});
 it('quarantines ambiguous company ticker mappings',async()=>{const s=await run(row()+row('BETA4'),securities+'2;20;1;2026-01-01;ALPH3;Ações Ordinárias;Bolsa;B3;2000-01-01;\n');expect(s.counts.ambiguous_rows).toBe(1);});
 it('rejects malformed amounts and unsafe numeric totals',async()=>{await expect(run(row('ALPH3','NaN'))).rejects.toThrow();await expect(run(row('ALPH3','9007199254740992'))).rejects.toThrow();});
 it('rejects source period drift',async()=>{await expect(run(row().replace('2026-09-30','2026-08-31'))).rejects.toThrow('invalid_source_period');});
 it('uses M-2 including year rollover',()=>{expect(defaultPeriod(new Date('2026-01-01'))).toBe('2025-11');expect(defaultPeriod(new Date('2026-11-05'))).toBe('2026-09');});
});
describe('bounded ZIP/CSV',()=>{
 it.each([0,8])('reads method %i and quoted fields across rows',async method=>{const z=new CsvZip(zip({'a.csv':'a;b\r\n"x;y";"z""q"\r\n"line\nbreak";1\n'},method));const r=[];for await(const row of z.csv('a.csv',['a','b']))r.push(row);expect(r).toEqual([{a:'x;y',b:'z"q'},{a:'line\nbreak',b:'1'}]);});
 it('rejects corrupted CRC',async()=>{const b=zip({'a.csv':'a\nx\n'},0);b[35]^=1;const z=new CsvZip(b);await expect(async()=>{for await(const r of z.csv('a.csv',['a']))void r;}).rejects.toThrow();});
 it('rejects encryption, unsupported methods, truncation and duplicate headers',async()=>{for(const b of [zip({'a.csv':'a\nx'}).subarray(0,-1),Buffer.alloc(22)])expect(()=>new CsvZip(b)).toThrow();const b=zip({'a.csv':'a\nx'});b.writeUInt16LE(1,6);expect(()=>new CsvZip(b)).toThrow();const z=new CsvZip(zip({'a.csv':'a;a\nx;y'}));await expect(async()=>{for await(const r of z.csv('a.csv',['a']))void r;}).rejects.toThrow('invalid_csv_header');});
 it('honors abort',async()=>{const a=new AbortController();a.abort();const z=new CsvZip(zip({'a.csv':'a\nx'}));await expect(async()=>{for await(const r of z.csv('a.csv',['a'],a.signal))void r;}).rejects.toThrow();});
});

describe('CVM validation boundaries',()=>{
 it('retains deterministic provenance and archive digests',async()=>{const s=await run();expect(s.license).toBe('ODbL-1.0');expect(s.source_urls.cda).toContain('cda_fi_202609.zip');expect(s.source_sha256.cda).toMatch(/^[a-f0-9]{64}$/);expect(snapshotSchema.safeParse({...s,source_urls:{...s.source_urls,cda:'https://example.org/x'}}).success).toBe(false);});
 it('validates cached date/coverage/total invariants',async()=>{const s=await run();for(const bad of [{...s,period:'invalid'},{...s,fetched_at:'invalid'},{...s,rows:[{...s.rows[0],flow:{buy:1.2,sell:0,net:1.2}}]},{...s,report_date:'2026-09-31'},{...s,classification_date:'2026-11-06'},{...s,counts:{...s.counts,confidential_funds:100}},{...s,counts:{...s.counts,matched_rows:20}}])expect(snapshotSchema.safeParse(bad).success).toBe(false);});
 it('normalizes acquisition timestamps using UTC rather than textual dates',async()=>{const f=fixtureArchives();const s=await parseCvm(f.cda,f.fca,'2026-09','2026-11-04T23:30:00-02:00','2026-11-04T23:31:00-02:00');expect(s.classification_date).toBe('2026-11-05');expect(snapshotSchema.safeParse(s).success).toBe(true);});
 it('rejects ticker share-type conflicts even for same issuer document',async()=>{const s=await run(row()+row('BETA4'),securities+'1;10;1;2026-01-01;ALPH3;Ações Preferenciais;Bolsa;B3;2000-01-01;\n');expect(s.counts.ambiguous_rows).toBe(1);expect(s.rows.some(r=>r.code==='ALPH3')).toBe(false);});
 it('keeps bare quotes inside official unquoted CSV fields',async()=>{const z=new CsvZip(zip({'a.csv':'a;b\nx;Some "quoted" words\n'}));const r=[];for await(const row of z.csv('a.csv',['a','b']))r.push(row);expect(r[0].b).toBe('Some "quoted" words');});
 it('rejects multidisk, oversized members, ZIP64 sizes, unsupported methods and local header mismatch',()=>{
  for(const mutate of [(b:Buffer,c:number,e:number)=>b.writeUInt16LE(1,e+4),(b:Buffer,c:number)=>b.writeUInt32LE(71*1024*1024,c+24),(b:Buffer,c:number)=>b.writeUInt32LE(0xffffffff,c+20),(b:Buffer,c:number)=>b.writeUInt16LE(99,c+10),(b:Buffer)=>b.writeUInt32LE(123,14)]){const b=zip({'a.csv':'a\nx'}),e=b.length-22,c=b.readUInt32LE(e+16);mutate(b,c,e);expect(()=>new CsvZip(b)).toThrow();}
 });
 it('rejects duplicate archive members',()=>{const b=zip({'a.csv':'a\nx','b.csv':'a\ny'});for(let i=0;i<b.length-5;i++)if(b.subarray(i,i+5).toString()==='b.csv')b[i]=97;expect(()=>new CsvZip(b)).toThrow();});
 it('bounds CSV fields and rejects unterminated quoted records',async()=>{for(const csv of ['a\n'+ 'x'.repeat(16385),'a\n"unterminated']){const z=new CsvZip(zip({'a.csv':csv}));await expect(async()=>{for await(const r of z.csv('a.csv',['a']))void r;}).rejects.toThrow();}});
 it('aborts an in-progress deflate stream cleanly',async()=>{const a=new AbortController(),z=new CsvZip(zip({'a.csv':'a\n'+'x\n'.repeat(100000)}));await expect(async()=>{for await(const r of z.csv('a.csv',['a'],a.signal)){void r;a.abort();}}).rejects.toThrow();});
});
