import {env,waitUntil} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createCvmHandler} from './handler';
import {D1CvmGate} from './source-gate';
// Keeps the existing owner-only host and independent acquisition gate/public-report cache.
export const cvmHandler=createCvmHandler({gate:new D1CvmGate(env.DB as unknown as GateD1),waitUntil});
