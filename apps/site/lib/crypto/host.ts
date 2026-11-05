import {env} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createKrakenHandler} from './kraken';
import {D1KrakenGate} from './source-gate';
// Existing owner-only host; this is not permission for public redistribution.
// The only external request is an unauthenticated GET to the fixed spot ticker.
export const krakenHandler=createKrakenHandler({gate:new D1KrakenGate(env.DB as unknown as GateD1)});
