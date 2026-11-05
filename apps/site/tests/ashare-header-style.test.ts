import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('allows the embedded heatmap header to grow when controls wrap',()=>{
 const css=readFileSync('components/ashare/styles.css','utf8');
 expect(css).toContain('.evidence-heatmap header{height:auto;min-height:0}');
});
