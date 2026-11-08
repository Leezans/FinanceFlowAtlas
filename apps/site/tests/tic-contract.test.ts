import {describe, expect, it} from 'vitest';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {normalize, snapshotSchema} from '../lib/tic/adapter';
import {validateTic, signedMillions, type TicSnapshot} from '../lib/tic/model';
import {projectTicMatrix} from '../lib/tic/matrix';
import {valid} from './tic-fixture';
import {ticFixture} from './ticTestFixture';

describe('shared browser and ingestion TIC contract', () => {
  it('accepts normalized synthetic data without rescaling or reversing identities', async () => {
    const snapshot = await normalize(valid(), '2026-08', '2026-11-08T00:00:00Z');
    const browser = validateTic(snapshot);
    expect(browser).toEqual(snapshotSchema.parse(snapshot));
    expect(browser.country_flows.map(row => [row.foreign_economy_iso3, row.net_foreign_purchases_usd]))
      .toEqual([['CAN', 0], ['GBR', -3000000], ['JPN', 5000000]]);
    expect(browser.country_flows.every(row => row.issuer_economy_iso3 === 'USA')).toBe(true);
    expect(browser.country_flows.map(row => signedMillions(row.net_foreign_purchases_usd))).toEqual(['0', '-3', '+5']);
    const matrix = projectTicMatrix(browser);
    expect(matrix.groups.find(group => group.id === 'Asia')?.items[0]).toMatchObject({
      id: 'JPN', label: 'Japan', colorValue: 5000000, displayValue: '+5 USD millions',
    });
    expect(browser.grand_total_net_foreign_purchases_usd).toBe(9000000);
  });

  const invalid: [string, (snapshot: TicSnapshot) => void][] = [
    ['Japan code with Brazil ISO', s => {s.country_flows[0].foreign_economy_iso3 = 'BRA';}],
    ['unknown Treasury code', s => {s.country_flows[0].treasury_country_code = 'unknown';}],
    ['invalid retrieval timestamp', s => {s.retrieved_at = 'not-a-date';}],
    ['invalid revision timestamp', s => {s.source_revision_published_at = 'not-a-date';}],
    ['wrong snapshot source', s => {Object.assign(s, {source_id: 'unrelated-source'});}],
    ['wrong row source', s => {Object.assign(s.country_flows[0], {source_id: 'unrelated-source'});}],
    ['wrong source URL', s => {Object.assign(s, {source_url: 'https://example.com/'});}],
    ['invalid hash', s => {s.raw_sha256 = 'test-only';}],
    ['empty observations', s => {s.country_flows = [];}],
    ['duplicate country', s => {s.country_flows.push(s.country_flows[0]);}],
    ['row month mismatch', s => {s.country_flows[0].period = '2026-07';}],
    ['unsupported month', s => {s.period = '2023-01';}],
    ['incomplete month', s => {s.retrieved_at = '2026-08-31T23:00:00Z';}],
    ['non-integer USD', s => {s.country_flows[0].net_foreign_purchases_usd = 1.5;}],
    ['unsafe USD', s => {s.country_flows[0].net_foreign_purchases_usd = Number.MAX_SAFE_INTEGER + 1;}],
    ['non-finite USD', s => {s.country_flows[0].net_foreign_purchases_usd = Infinity;}],
    ['invalid total', s => {s.grand_total_net_foreign_purchases_usd = NaN;}],
    ['negative excluded count', s => {s.excluded_records.missing_transaction_value = -1;}],
  ];
  it.each(invalid)('rejects %s in both entry points', (_name, mutate) => {
    const snapshot = structuredClone(ticFixture);
    mutate(snapshot);
    expect(snapshotSchema.safeParse(snapshot).success).toBe(false);
    expect(() => validateTic(snapshot)).toThrow();
  });

  it('keeps the explicit legacy-null read exception without weakening ingestion', () => {
    const legacy = {...ticFixture, grand_total_net_foreign_purchases_usd: null};
    expect(validateTic(legacy).grand_total_net_foreign_purchases_usd).toBeNull();
    expect(signedMillions(validateTic(legacy).grand_total_net_foreign_purchases_usd)).toBe('—');
    expect(snapshotSchema.safeParse(legacy).success).toBe(false);
    expect(snapshotSchema.safeParse(ticFixture).success).toBe(true);
    expect(() => validateTic({...legacy, retrieved_at: 'invalid'})).toThrow();
  });

  it('bundles the browser validator without the server parser or runtime', async () => {
    const require = createRequire(import.meta.url);
    const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
    const {build} = wranglerRequire('esbuild');
    const result = await build({
      entryPoints: [fileURLToPath(new URL('../lib/tic/model.ts', import.meta.url))],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
    });
    const inputs = Object.keys(result.metafile.inputs) as string[];
    expect(inputs.some(path => path.endsWith('lib/tic/contract.ts'))).toBe(true);
    expect(inputs.some(path => path.endsWith('lib/tic/geography.ts'))).toBe(true);
    expect(inputs.filter(path => /lib\/tic\/(adapter|table|cache|source-gate|repository|route)\.ts$/.test(path))).toEqual([]);
    expect(result.outputFiles[0].text).not.toMatch(/cloudflare:workers|node:crypto|readTable|crypto\.subtle/);
  });
});
