import React from 'react';
import {renderToString} from 'react-dom/server';
import {it,expect} from 'vitest';
import TicTreemap from '../components/atlas/TicTreemap';
import {ticFixture} from './ticTestFixture';
it('server-renders SVG titles as single text nodes without hydration separator comments',()=>{
 const html=renderToString(<TicTreemap rows={ticFixture.country_flows} country="" region="" palette="china" onCountry={()=>{}} onRegion={()=>{}} period="2026-08" unavailable={false}/>);
 const titles=[...html.matchAll(/<title>([\s\S]*?)<\/title>/g)].map(match=>match[1]);
 expect(titles.length).toBeGreaterThan(1);
 expect(titles.some(title=>title.includes('Japan'))).toBe(true);
 for(const title of titles)expect(title).not.toContain('<!--');
});
