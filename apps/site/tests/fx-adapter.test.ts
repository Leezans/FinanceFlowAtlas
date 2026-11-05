import {describe,expect,it,vi} from 'vitest';
import {fetchEcb,parseEcb} from '../lib/fx/ecb';
import {ECB_URL,MAX_SOURCE_BYTES,crossRate,fxPayloadSchema,referenceAgeDays} from '../lib/fx/model';
import {FX_NOW,fxXml,fxResponse,fxPayload} from './fx-fixture';
const now=new Date(FX_NOW).toISOString();
describe('ECB daily XML reference contract',()=>{
 it('retains date, all currency codes, source precision and explicit concept',()=>{
  const snapshot=parseEcb(fxXml(),now);expect(snapshot).toMatchObject({base_currency:'EUR',reference_date:'2026-06-08',retrieved_at:now,concept:'exchange_rate_reference'});
  expect(snapshot.rates.map(r=>r.currency)).toEqual(['CNY','JPY','USD']);expect(snapshot.rates[0].per_eur).toBe('10.0000');
 });
 it('does not assume a fixed currency list or invent absent currencies',()=>{
  const snapshot=parseEcb(fxXml('2026-06-08',"<Cube currency='CAD' rate='3'/><Cube currency='XXX' rate='4'/>"),now);expect(snapshot.rates).toHaveLength(2);expect(crossRate(snapshot,'USD','CNY')).toBeNull();
 });
 it.each([
  ['duplicate',fxXml().replace("currency='JPY'","currency='USD'")],
  ['zero',fxXml().replace("rate='2.0000'","rate='0'")],
  ['negative',fxXml().replace("rate='2.0000'","rate='-2'")],
  ['NaN',fxXml().replace("rate='2.0000'","rate='NaN'")],
  ['infinite',fxXml().replace("rate='2.0000'","rate='1e309'")],
  ['invalid date',fxXml('2026-02-30')],['future',fxXml('2026-06-09')],
  ['EUR quoted',fxXml().replace("currency='USD'","currency='EUR'")],
  ['unknown namespace',fxXml().replace('www.ecb.int','attacker.invalid')],
  ['empty',fxXml('2026-06-08','')],['truncated',fxXml().slice(0,-8)],
  ['extra rows outside dated cube',fxXml().replace('</gesmes:Envelope>',"<Cube currency='CAD' rate='3'/></gesmes:Envelope>")],
  ['DTD',fxXml().replace('<gesmes:Envelope','<!DOCTYPE foo [<!ENTITY bar "baz">]><gesmes:Envelope')],
  ['entity',fxXml().replace('Reference rates','&bogus;')],
  ['duplicate date',fxXml().replace('</Cube></gesmes:Envelope>',"<Cube time='2026-06-08'><Cube currency='CAD' rate='2'/></Cube></Cube></gesmes:Envelope>")],
  ['wrong publisher',fxXml().replace('European Central Bank','Other publisher')],['oversized',' '.repeat(MAX_SOURCE_BYTES)+fxXml()],
 ])('rejects %s',(_label,xml)=>expect(()=>parseEcb(xml,now)).toThrow('invalid_source'));
 it('calculates and labels cross rates separately from observations',()=>{
  const snapshot=parseEcb(fxXml(),now);expect(crossRate(snapshot,'EUR','USD')).toBe(2);expect(crossRate(snapshot,'USD','CNY')).toBe(5);expect(crossRate(snapshot,'CNY','USD')).toBe(.2);expect(crossRate(snapshot,'CNY','CNY')).toBe(1);expect(referenceAgeDays('2026-06-05',FX_NOW)).toBe(3);
 });
 it('only requests a fixed official source without credentials or redirects',async()=>{
  const fetcher=vi.fn(async()=>fxResponse());await fetchEcb(fetcher,()=>FX_NOW);
  expect(fetcher).toHaveBeenCalledWith(ECB_URL,expect.objectContaining({redirect:'manual',cache:'no-store'}));expect(fetcher.mock.calls).toHaveLength(1);
 });
 it.each([301,302,303,307,308,401,403,407,429,451])('stops on HTTP %s instead of following alternatives',async status=>{
  const fetcher=vi.fn(async()=>new Response(null,{status}));await expect(fetchEcb(fetcher,()=>FX_NOW)).rejects.toMatchObject({code:'source_stopped'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('stops if the fetch implementation has already followed a redirect',async()=>{
  const response=fxResponse();Object.defineProperty(response,'redirected',{value:true});
  const fetcher=vi.fn(async()=>response);await expect(fetchEcb(fetcher,()=>FX_NOW)).rejects.toMatchObject({code:'source_stopped'});expect(fetcher).toHaveBeenCalledTimes(1);expect(response.bodyUsed).toBe(false);
 });
 it.each([200,503])('stops on XHTML challenge pages with HTTP %s',async status=>{
  const fetcher=vi.fn(async()=>new Response('<html xmlns="http://www.w3.org/1999/xhtml">challenge</html>',{status,headers:{'content-type':'application/xhtml+xml; charset=utf-8'}}));
  await expect(fetchEcb(fetcher,()=>FX_NOW)).rejects.toMatchObject({code:'source_stopped'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('rejects invalid content type, oversized streams and bad UTF-8',async()=>{
  await expect(fetchEcb(async()=>new Response('<html>challenge</html>',{headers:{'content-type':'text/html'}}),()=>FX_NOW)).rejects.toMatchObject({code:'source_stopped'});
  await expect(fetchEcb(async()=>fxResponse('a'.repeat(MAX_SOURCE_BYTES+1)),()=>FX_NOW)).rejects.toMatchObject({code:'invalid_source'});
  await expect(fetchEcb(async()=>new Response(new Uint8Array([255,255]),{headers:{'content-type':'text/xml'}}),()=>FX_NOW)).rejects.toMatchObject({code:'invalid_source'});
 });
 it('returns a safe validation failure for invalid API dates rather than throwing',()=>{
  const payload=fxPayload();payload.snapshot!.retrieved_at='not a date';expect(fxPayloadSchema.safeParse(payload).success).toBe(false);
 });
});
