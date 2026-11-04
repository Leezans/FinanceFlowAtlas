import {describe,it,expect} from 'vitest';
import {validateTic,signedMillions,selectTicRows,flowDirection} from '../components/atlas/ticModel';
import {ticFixture} from './ticTestFixture';
describe('TIC units and signed transactions',()=>{
 it('accepts negative and zero transactions without changing identities',()=>{const s=validateTic(ticFixture);expect(s.country_flows[1].net_foreign_purchases_usd).toBe(-3000000);expect(s.country_flows[1].issuer_economy_iso3).toBe('USA');expect(s.country_flows[1].foreign_economy_iso3).toBe('GBR');expect(s.country_flows[2].net_foreign_purchases_usd).toBe(0)});
 it('converts normalized USD back to source millions exactly once',()=>{expect(signedMillions(5000000)).toBe('+5');expect(signedMillions(-3000000)).toBe('-3');expect(signedMillions(0)).toBe('0');expect(signedMillions(null)).toBe('—')});
 it('rejects holdings, altered units and duplicate countries',()=>{expect(()=>validateTic({...ticFixture,concept:'position'})).toThrow();expect(()=>validateTic({...ticFixture,output_unit:'USD millions'})).toThrow();expect(()=>validateTic({...ticFixture,country_flows:[ticFixture.country_flows[0],ticFixture.country_flows[0]]})).toThrow()});
 it('separates positive, negative, zero, missing and unavailable months',()=>{expect(selectTicRows(ticFixture,'2026-08','','positive')).toHaveLength(1);expect(selectTicRows(ticFixture,'2026-08','','negative')[0].foreign_economy_iso3).toBe('GBR');expect(selectTicRows(ticFixture,'2026-08','','zero')).toHaveLength(1);expect(selectTicRows(ticFixture,'2026-07','','all')).toHaveLength(0);expect(selectTicRows(ticFixture,'2026-08','FRA','all')).toHaveLength(0);expect(flowDirection(-1)).toContain('净卖出')});
});
