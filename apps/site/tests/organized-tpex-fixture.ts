/** Synthetic observations only. Includes negative, observed zero, and missing flow. */
import {snapshot,reply} from './tpex-fixture';
import type {TpexSnapshot} from '../lib/tpex/model';
export function tpexShareSnapshot():TpexSnapshot {
 const result=snapshot(),zero={buy:0,sell:0,net:0};
 result.rows.push({code:'1004',name:'合成零交易',industry_code:'99',flow:{total:{...zero},foreign:{...zero},trust:{...zero},dealer:{...zero}}});
 result.source_security_count++;
 return result;
}
export function tpexShareReply(){return {...reply(),snapshot:tpexShareSnapshot()};}
