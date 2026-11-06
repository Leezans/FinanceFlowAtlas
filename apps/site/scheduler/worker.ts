import {createAshareHandler} from '../lib/ashare/ashare';
import {D1SourceGate} from '../lib/ashare/source-gate';
import {D1SnapshotStore, type SnapshotD1} from '../lib/ashare/snapshot-store';
import {D1StageStore} from '../lib/ashare/stage-store';
import {SchedulerStore} from './state';
import {runSchedulerTick} from './runner';

export type SchedulerEnv = {DB: SnapshotD1; ASHARE_SCHEDULER_ENABLED?: string; ASHARE_SCHEDULER_SCOPES?: string};
const worker = {
  // Never expose collected evidence, health state, a run-now endpoint or an
  // authentication bypass. workers.dev and preview URLs are disabled as well.
  fetch() { return new Response('Not found', {status: 404}); },
  async scheduled(event: ScheduledController, env: SchedulerEnv, ctx: ExecutionContext) {
    const handler = createAshareHandler({enabled: () => env.ASHARE_SCHEDULER_ENABLED === 'true',
      runtime: 'cloudflare-workers', waitUntil: promise => ctx.waitUntil(promise),
      sourceGate: new D1SourceGate(env.DB), snapshotStore: new D1SnapshotStore(env.DB, {staged: true}),
      stageStore: new D1StageStore(env.DB)});
    const result = await runSchedulerTick({enabled: env.ASHARE_SCHEDULER_ENABLED,
      scopes: env.ASHARE_SCHEDULER_SCOPES, scheduledTime: event.scheduledTime,
      store: new SchedulerStore(env.DB), request: handler});
    // Metadata only: no source rows, response bodies, lease tokens or credentials.
    console.log(JSON.stringify({component: 'ashare_scheduler', ...result}));
  },
};

export default worker;
