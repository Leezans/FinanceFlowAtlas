import {env} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {D1FxGate} from './source-gate';
import {createFxService} from './service';
// Existing primary DB binding, metadata only; no additional access permissions.
export const fxService=createFxService(fetch,Date.now,new D1FxGate(env.DB as unknown as GateD1));
