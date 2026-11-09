import {readFileSync, readdirSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

describe('news expansion migration inventory', () => {
  const migrations = readdirSync('drizzle').filter(name => /^\d{4}.*\.sql$/.test(name)).sort();
  it('matches the journal, native harness counts and final migration without starting workerd', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
    expect(migrations).toHaveLength(27);
    expect(journal.entries.map((entry: {tag: string}) => `${entry.tag}.sql`)).toEqual(migrations);
    expect(migrations.at(-1)).toBe('0026_news_asia_technology.sql');
    const deribit = readFileSync('scripts/test-deribit-runtime.mjs', 'utf8');
    const taifex = readFileSync('scripts/test-taifex-options-runtime.mjs', 'utf8');
    expect(deribit).toContain(`assert.equal(migrations.length+1,${migrations.length});`);
    expect(taifex).toContain(`assert.equal(migrations.length, ${migrations.length},`);
    expect(taifex).toContain(`assert.equal(migrations.at(-1), '${migrations.at(-1)}');`);
  });
});
