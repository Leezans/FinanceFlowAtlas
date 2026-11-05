import {env} from 'cloudflare:workers';
import type {GateD1} from '../ashare/source-gate';
import {createSinaIndustryHandler} from './industry';
import {D1SinaGate} from './source-gate';
// Candidate only, NOT a live connection. No source requests or cached observations
// are served until the intended owner-only usage has been reviewed and enabled.
// Public code publication is not permission to redistribute provider data.
export const sinaIndustryHandler=createSinaIndustryHandler({
  enabled:()=>false,
  runtime:'cloudflare-workers',
  sourceGate:new D1SinaGate(env.DB as unknown as GateD1),
});
