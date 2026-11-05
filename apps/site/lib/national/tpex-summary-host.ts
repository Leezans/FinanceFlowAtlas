import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createTpexSummaryHandler} from './tpex-summary-runtime';
import {D1TpexSummaryGate} from './tpex-summary-gate';
export const tpexSummaryHandler=createTpexSummaryHandler({gate:new D1TpexSummaryGate(env.DB as unknown as GateD1),waitUntil});
