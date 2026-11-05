import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createJapanMofHandler} from './runtime';
import {D1JapanMofGate} from './source-gate';
// Inherits the site's owner-only hosting boundary; no anonymous alternate route.
export const japanMofHandler=createJapanMofHandler({gate:new D1JapanMofGate(env.DB as unknown as GateD1),waitUntil});
