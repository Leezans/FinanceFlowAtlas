import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createOptionsHandler} from './handler';
import {D1OptionsGate} from './source-gate';
export const optionsHandler=createOptionsHandler({gate:new D1OptionsGate(env.DB as unknown as GateD1),waitUntil});
