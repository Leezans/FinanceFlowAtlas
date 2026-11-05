import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createFdiHandler} from './handler';
import {D1FdiGate} from './source-gate';
// Keeps the existing owner-only host and independent acquisition gate/public-report cache.
export const aseanHandler=createFdiHandler({gate:new D1FdiGate(env.DB as unknown as GateD1),waitUntil});
