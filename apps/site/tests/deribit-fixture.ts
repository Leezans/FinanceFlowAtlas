import type {OptionsReply,OptionRow,OptionCurrency} from '../lib/options/model';
export const at=Date.parse('2026-11-06T03:00:00Z'),iso=new Date(at).toISOString();
export function optionRow(overrides:Partial<OptionRow>={}):OptionRow{return {underlying_currency:'BTC',instrument:'BTC-27NOV26-80000-C',expiration_timestamp:Date.parse('2026-11-27T08:00:00Z'),strike:80000,option_type:'call',contract_size:1,creation_timestamp:at,mark_price:0.02,mark_iv:55,price_change:2,bid_price:0.019,ask_price:0.021,last:0.02,volume:3,volume_usd:300,open_interest:10,...overrides};}
/** Synthetic only: these numbers are not market observations. */
export function optionsReply():OptionsReply{return {snapshot:{schema:'deribit-options/2',source:'Deribit',currencies:['BTC'],coverage:'deribit_btc_options',acquisition_started_at:iso,fetched_at:iso,source_as_of:iso,net_capital_flow:null,rows:[optionRow(),optionRow({instrument:'BTC-27NOV26-80000-P',option_type:'put',volume:1,volume_usd:100,price_change:-1}),optionRow({instrument:'BTC-27NOV26-90000-C',strike:90000,volume:0,volume_usd:0,price_change:null})],metadata_fetched_at:{BTC:iso},delay_policy:'source_delay_unconfirmed'},status:{state:'available',error_code:null,last_attempt_at:iso,fetched_at:iso,cache_age_ms:0,refresh_ms:60000,max_cache_age_ms:300000,next_retry_at:new Date(at+60000).toISOString()}};}

/** Synthetic ETH values deliberately differ from BTC; no conversion is implied. */
export function ethOptionRow(overrides:Partial<OptionRow>={}):OptionRow{return optionRow({underlying_currency:'ETH',instrument:'ETH-27NOV26-3000-C',strike:3000,contract_size:1,mark_price:.03,mark_iv:65,price_change:4,bid_price:.029,ask_price:.031,last:.03,volume:12,volume_usd:900,open_interest:40,...overrides});}
export function combinedOptionsReply():OptionsReply{
 const reply=optionsReply(),snapshot=reply.snapshot!;
 snapshot.currencies=['BTC','ETH'];snapshot.coverage='deribit_btc_eth_options';snapshot.metadata_fetched_at.ETH=iso;
 snapshot.rows.push(ethOptionRow(),ethOptionRow({instrument:'ETH-27NOV26-3000-P',option_type:'put',volume:4,volume_usd:300,price_change:-2}),ethOptionRow({instrument:'ETH-27NOV26-3500-C',strike:3500,volume:0,volume_usd:0,price_change:null}));
 return reply;
}
export function singleCurrencyOptionsReply(currency:OptionCurrency):OptionsReply{
 if(currency==='BTC')return optionsReply();
 const reply=combinedOptionsReply(),snapshot=reply.snapshot!;
 snapshot.currencies=['ETH'];snapshot.coverage='deribit_eth_options';snapshot.metadata_fetched_at={ETH:iso};snapshot.rows=snapshot.rows.filter(row=>row.underlying_currency==='ETH');
 return reply;
}
