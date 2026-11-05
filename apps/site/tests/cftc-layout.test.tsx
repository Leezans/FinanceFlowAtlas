// @vitest-environment jsdom
import React from 'react';
import {readFileSync} from 'node:fs';
import {render,cleanup,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import FuturesPositioning from '../components/futures/FuturesPositioning';
import styles from '../components/futures/futures.module.css';
afterEach(cleanup);
it('owns a full-height dark surface rather than inheriting the white page body',()=>{
 render(<FuturesPositioning/>);
 expect(screen.getByRole('main').parentElement?.className).toBe(styles.surface);
 const css=readFileSync('components/futures/futures.module.css','utf8');
 expect(css).toContain('.surface{min-height:100vh;background:#0b151c}');
 expect(css).toContain('color:#dce7ef');
 expect(css).toContain('.root button{min-height:44px;');
});
