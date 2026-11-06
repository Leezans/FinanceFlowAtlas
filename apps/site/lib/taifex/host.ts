import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createTaifexProvider} from './handler';
import {D1TaifexGate} from './source-gate';
const provider=createTaifexProvider({gate:new D1TaifexGate(env.DB as unknown as GateD1),waitUntil});
export const taifexOptionsHandler=provider.optionsHandler;
export const taifexFuturesHandler=provider.futuresHandler;
