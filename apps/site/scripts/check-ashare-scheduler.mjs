/** Operator-invoked read-only check. No credentials are created, stored or logged. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--config' || !args[1] || args[2] !== '--remote') {
  console.error('Usage: npm run scheduler:status -- --config scheduler/wrangler.local.jsonc --remote');
  console.error('Requires an already-authorized Cloudflare session for the same primary D1. Performs only SELECTs.');
  process.exit(2);
}
const require = createRequire(import.meta.url);
const wrangler = fileURLToPath(new URL('bin/wrangler.js', pathToFileURL(require.resolve('wrangler/package.json'))));
const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'DB', '--config', args[1], '--remote',
  '--file', fileURLToPath(new URL('../scheduler/status.sql', import.meta.url)), '--json'], {encoding: 'utf8', env: {...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false'}});
if (result.status !== 0) {
  console.error('Scheduler status could not be confirmed. Check the existing account session, binding and optional schema.');
  process.exit(2);
}
try {
  const output = JSON.parse(result.stdout);
  const rows = output.flatMap(item => item.results ?? []);
  if (!rows.some(row => row.component === 'scheduler') || !rows.some(row => row.component === 'source_gate')) throw new Error();
  console.log(JSON.stringify(rows, null, 2));
  process.exit(rows.every(row => ['healthy','running','source_busy','source_cooldown'].includes(row.health)) ? 0 : 1);
} catch {
  console.error('Scheduler status response was not recognized; no healthy result is claimed.');
  process.exit(2);
}
