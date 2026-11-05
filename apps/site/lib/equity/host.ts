import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createEquityHandler} from './handler';
import {D1EquityGate} from './source-gate';
// Keeps the existing owner-only host and independent acquisition gate/public-report cache.
export const equityHandler=createEquityHandler({gate:new D1EquityGate(env.DB as unknown as GateD1),waitUntil});
