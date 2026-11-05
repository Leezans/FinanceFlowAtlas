import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../components/asean/asean.module.css',import.meta.url),'utf8');
describe('ASEAN responsive matrix layout',()=>{
 it('fits the selected country into the available canvas',()=>{expect(css).toContain('.heatmap[data-single-country=true]{min-width:0;table-layout:fixed}');expect(css).toContain('white-space:normal;overflow-wrap:anywhere');});
 it('keeps the top-left industry header above horizontally scrolling countries',()=>{expect(css).toContain('.heatmap thead th:first-child{position:sticky;left:0;z-index:2;');});
});
