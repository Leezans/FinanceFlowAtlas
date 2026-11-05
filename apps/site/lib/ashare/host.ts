import {env,waitUntil} from 'cloudflare:workers';
import {createAshareHandler} from './ashare';
import {D1SourceGate,type GateD1} from './source-gate';
// Existing owner-only Sites host covers UI and API. No public redistribution.
// A-share payloads remain ephemeral memory only; DB stores coordination metadata.
export const ashareHandler=createAshareHandler({
 enabled:()=>true,
 runtime:'cloudflare-workers',
 waitUntil,
 sourceGate:new D1SourceGate(env.DB as unknown as GateD1),
});
