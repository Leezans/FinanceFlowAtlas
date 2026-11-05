import {describe, expect, it} from 'vitest';
import {projectTicMatrix} from '../lib/tic/matrix';
import {ticFixture} from './ticTestFixture';
const items = (matrix: ReturnType<typeof projectTicMatrix>) => matrix.groups.flatMap(group => group.items);
describe('pure TIC country projection', () => {
 it('groups actual residence evidence by region, keeps signed units and observed zeros', () => {
  const matrix = projectTicMatrix(ticFixture);
  expect(matrix.groups.map(group => group.label)).toEqual(['美洲', '亚洲', '欧洲']);
  expect(items(matrix)).toHaveLength(3);
  expect(items(matrix).find(item => item.id === 'GBR')).toMatchObject({displayValue: '-3 USD millions', colorValue: -3000000, weight: 1});
  expect(items(matrix).find(item => item.id === 'CAN')).toMatchObject({displayValue: '0 USD millions', colorValue: 0, weight: 1});
  expect(items(matrix).some(item => item.id === 'FRA' || item.id === 'USA')).toBe(false);
  expect(items(matrix).some(item => item.colorValue === ticFixture.grand_total_net_foreign_purchases_usd)).toBe(false);
  expect(matrix.reportedCountries).toBe(3);
 });
 it('keeps the original full-period scale when filtering country, region or direction', () => {
  for (const scope of [{country: 'GBR'}, {region: 'Europe'}, {sign: 'negative'}]) {
   const matrix = projectTicMatrix(ticFixture, scope);
   expect(items(matrix).map(item => item.id)).toEqual(['GBR']);
   expect(matrix.colorMaxAbs).toBe(5000000);
   expect(matrix.regions).toHaveLength(3);
  }
 });
 it('has no synthetic country tiles and retains precision for small nonzero amounts', () => {
  expect(projectTicMatrix(null).groups).toEqual([]);
  expect(items(projectTicMatrix(ticFixture, {country: 'FRA'}))).toEqual([]);
  const tiny = {...ticFixture, country_flows: [{...ticFixture.country_flows[0], net_foreign_purchases_usd: 1}]};
  expect(items(projectTicMatrix(tiny))[0].displayValue).toBe('+0.000001 USD millions');
 });
});
