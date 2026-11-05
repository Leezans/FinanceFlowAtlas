import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createTpexHandler} from './handler';
import {D1TpexGate} from './source-gate';
// Keeps the existing owner-only host and independent acquisition gate/public-report cache.
export const tpexHandler=createTpexHandler({gate:new D1TpexGate(env.DB as unknown as GateD1),waitUntil});
