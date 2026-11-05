/** Entirely synthetic rates and dates. Never captures financial observations. */
import {parseEcb} from '../lib/fx/ecb';
import type {FxPayload} from '../lib/fx/model';
export const FX_NOW=Date.parse('2026-06-08T16:00:00Z');
export function fxXml(date='2026-06-08',rows="<Cube currency='USD' rate='2.0000'/><Cube currency='CNY' rate='10.0000'/><Cube currency='JPY' rate='200.00'/>"){
 return `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><gesmes:subject>Reference rates</gesmes:subject><gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender><Cube><Cube time='${date}'>${rows}</Cube></Cube></gesmes:Envelope>`;
}
export function fxResponse(body=fxXml(),status=200){return new Response(body,{status,headers:{'content-type':'text/xml'}})}
export function fxPayload():FxPayload{return {snapshot:parseEcb(fxXml(),new Date(FX_NOW).toISOString()),source_state:'available',checked_at:new Date(FX_NOW).toISOString(),next_check_at:new Date(FX_NOW+3_600_000).toISOString(),error_code:null}}
