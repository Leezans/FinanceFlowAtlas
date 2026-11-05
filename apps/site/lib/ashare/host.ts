import {env,waitUntil} from 'cloudflare:workers';
import {createAshareHandler} from './ashare';
import {D1SourceGate} from './source-gate';
import {D1SnapshotStore,type SnapshotD1} from './snapshot-store';
const db=env.DB as unknown as SnapshotD1;
// Existing owner-only Sites host covers UI and API. No public redistribution.
// Gate and last-good evidence share a primary binding for atomic publication.
export const ashareHandler=createAshareHandler({
 enabled:()=>true,
 runtime:'cloudflare-workers',
 waitUntil,
 sourceGate:new D1SourceGate(db),
 snapshotStore:new D1SnapshotStore(db),
});
