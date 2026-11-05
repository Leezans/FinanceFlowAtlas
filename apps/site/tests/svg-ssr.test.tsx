import React from 'react';
import {renderToString} from 'react-dom/server';
import {it, expect} from 'vitest';
import MatrixHeatmap from '../components/matrix/MatrixHeatmap';
import {projectTicMatrix} from '../lib/tic/matrix';
import {ticFixture} from './ticTestFixture';
it('server-renders shared matrix SVG titles as single text nodes without hydration separator comments', () => {
 const html = renderToString(<MatrixHeatmap groups={projectTicMatrix(ticFixture).groups} title="TIC" colorMeaning="Signed net" areaMeaning="Equal country areas"/>);
 const titles = [...html.matchAll(/<title>([\s\S]*?)<\/title>/g)].map(match => match[1]);
 expect(titles.length).toBeGreaterThan(1);
 expect(titles.some(title => title.includes('Japan'))).toBe(true);
 for (const title of titles) expect(title).not.toContain('<!--');
});
