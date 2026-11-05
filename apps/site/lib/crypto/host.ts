import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createKrakenHandler} from './kraken';
import {D1KrakenGate} from './source-gate';
// Existing owner-only host; this is not permission for public redistribution.
// Fixed unauthenticated market-data GETs only; both use the same source gate.
export const krakenHandler=createKrakenHandler({gate:new D1KrakenGate(env.DB as unknown as GateD1),waitUntil});
