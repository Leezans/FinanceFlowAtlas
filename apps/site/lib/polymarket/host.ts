import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createPolymarketHandler} from './handler';
import {D1PolymarketGate} from './source-gate';
// Existing owner-private boundary; no account, wallet, order or redistribution.
export const polymarketHandler=createPolymarketHandler({gate:new D1PolymarketGate(env.DB as unknown as GateD1),waitUntil});
