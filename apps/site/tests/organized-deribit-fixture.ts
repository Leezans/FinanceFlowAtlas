import {replySchema,visibleSnapshot,type OptionsReply} from '../lib/options/model';
import {projectDeribitReport,type DeribitInputSchema} from '../lib/evidence/deribit-projection';
import {at,iso,optionsReply,combinedOptionsReply} from './deribit-fixture';
export function legacyOptionsReply(){
 const reply=optionsReply(),snapshot=reply.snapshot!;
 return {...reply,snapshot:{schema:'deribit-btc-options/1' as const,source:snapshot.source,currency:'BTC' as const,coverage:'deribit_btc_options' as const,
  acquisition_started_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at,source_as_of:new Date(at-1000).toISOString(),metadata_fetched_at:iso,net_capital_flow:null,delay_policy:snapshot.delay_policy,
  rows:snapshot.rows.map(({underlying_currency:ignored,...row})=>{void ignored;return row;})}};
}
export function organizedOptions(reply:OptionsReply|ReturnType<typeof legacyOptionsReply>=combinedOptionsReply(),now=at,stale=false){
 const validated=replySchema.parse(reply);
 return projectDeribitReport(visibleSnapshot(validated,now),stale,{input_schema:reply.snapshot?.schema as DeribitInputSchema|null??null,source_instrument_count:validated.snapshot?.rows.length??null});
}
/** Source clock's earliest rows disappear together, leaving one currency active. */
export function expiringOptionsReply(){
 const reply=combinedOptionsReply();reply.snapshot!.rows.forEach(row=>{
  if(row.underlying_currency==='BTC')row.expiration_timestamp=at+2000;
  else row.creation_timestamp=at+1000;
 });return reply;
}
