import { env, waitUntil } from 'cloudflare:workers';
import type { GateD1 } from '../ashare/source-gate';
import { D1NewsGate } from './source-gate';
import { NewsService } from './service';
// Existing owner-private host and direct primary D1. Missing binding/schema fails closed.
const service = new NewsService(fetch, () => new Date(), new D1NewsGate(env.DB as unknown as GateD1 | undefined));
export function loadNewsSnapshot() {
  const operation = service.snapshot();
  waitUntil(operation.then(() => undefined));
  return operation;
}
