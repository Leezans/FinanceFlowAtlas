import {env,waitUntil} from 'cloudflare:workers';
import {D1KrakenSnapshotStore,type KrakenSnapshotD1} from './snapshot-store';
import {createKrakenHandler} from './kraken';
import {D1KrakenGate} from './source-gate';
// Existing owner-only host; this is not permission for public redistribution.
// Fixed unauthenticated market-data GETs only; both use the same source gate.
export const krakenHandler=createKrakenHandler({gate:new D1KrakenGate(env.DB as unknown as KrakenSnapshotD1),snapshotStore:new D1KrakenSnapshotStore(env.DB as unknown as KrakenSnapshotD1),waitUntil,includeTradeImbalance:true});
