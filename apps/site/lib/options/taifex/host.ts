import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../../ashare/source-gate';
import {createTaifexHandler} from './handler';
import {D1TaifexGate} from './source-gate';
export const taifexHandler=createTaifexHandler({gate:new D1TaifexGate(env.DB as unknown as GateD1),waitUntil});
