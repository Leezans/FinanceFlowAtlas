import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createCftcHandler} from './handler';
import {D1CftcGate} from './source-gate';
// Keeps the existing owner-only host and independent acquisition gate/public-report cache.
export const cftcHandler=createCftcHandler({gate:new D1CftcGate(env.DB as unknown as GateD1),waitUntil});
