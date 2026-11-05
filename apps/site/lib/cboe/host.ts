import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createCboeHandler} from './handler';
import {D1CboeGate} from './source-gate';
// Keeps the existing owner-only host and independent acquisition gate/private delayed-quote cache.
export const cboeHandler=createCboeHandler({gate:new D1CboeGate(env.DB as unknown as GateD1),waitUntil});
