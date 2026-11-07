import {describe,it,expect} from 'vitest';
import {compareExchangeBalances} from '@/lib/crypto/exchange-balances';
const day=86400,t=Date.UTC(2026,10,1)/1000,now=(t+4*day+3600)*1000;
const point=(date:number,tokens:Record<string,number>)=>({date,tokens});
const payload=()=>({name:'Binance CEX',chains:['Ethereum'],tokens:[point(t,{BTC:2,ETH:10}),point(t+day,{BTC:3,ETH:8}),point(t+2*day,{BTC:4,ETH:6}),point(t+3*day,{BTC:5,ETH:4}),point(t+4*day,{BTC:100}),point(t+4*day+60,{BTC:200})],tokensInUsd:[point(t+3*day,{BTC:500,ETH:40})]});
describe('tracked exchange balances',()=>{
 it('excludes current midnight and partial tails; prices quantity deltas at the end snapshot',()=>{
  const r=compareExchangeBalances(payload(),now);expect(r.start).toBe(t+2*day);expect(r.end).toBe(t+3*day);expect(r.excluded).toBe(2);
  expect(r.rows[0]).toEqual({asset:'BTC',before:4,after:5,change:1,priceUsd:100,changeAtEndPriceUsd:100});
  expect(r.rows[1].change).toBe(-2);
 });
 it('does not zero-fill added or missing assets',()=>{const p=payload();p.tokens[3].tokens={BTC:0,NEW:2};const r=compareExchangeBalances(p,now);expect(r.coverageChanged).toBe(true);expect(r.rows.find(x=>x.asset==='ETH')?.change).toBeNull();expect(r.rows.find(x=>x.asset==='NEW')?.change).toBeNull();expect(r.rows[0].priceUsd).toBeNull();});
 it('requires exact USD timestamp matching',()=>{const p=payload();p.tokensInUsd[0].date++;expect(compareExchangeBalances(p,now).rows[0].priceUsd).toBeNull();});
 it('does not bridge missing days',()=>{const p=payload();p.tokens.splice(2,1);expect(()=>compareExchangeBalances(p,now)).toThrow('连续');});
 it('rejects duplicate or future snapshots',()=>{const p=payload();p.tokens.push(p.tokens[0]);expect(()=>compareExchangeBalances(p,now)).toThrow('重复');expect(()=>compareExchangeBalances(payload(),t*1000)).toThrow('未来');});
 it.each([NaN,Infinity,-1])('rejects invalid native quantities %s',n=>{const p=payload();p.tokens[0].tokens.BTC=n;expect(()=>compareExchangeBalances(p,now)).toThrow('无效数量');});
 it('requires expected identity',()=>{expect(()=>compareExchangeBalances({...payload(),name:'Other'},now)).toThrow('Binance');});
});
