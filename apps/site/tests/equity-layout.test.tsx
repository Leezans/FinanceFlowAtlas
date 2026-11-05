// @vitest-environment jsdom
import React from 'react';
import {readFileSync} from 'node:fs';
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import EquityContext from '../components/equity/EquityContext';
import styles from '../components/equity/equity.module.css';

vi.mock('../hooks/useEquitySnapshot', () => ({useEquitySnapshot: () => ({
  data: null, snapshot: null, loading: false, failure: null,
  stale: false, denied: false, refresh: vi.fn(),
})}));
afterEach(cleanup);

function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)!.map(part => parseInt(part, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

it('owns an edge-to-edge, full-height dark surface independently of the white app body', () => {
  render(<EquityContext/>);
  const main = screen.getByRole('main');
  expect(main.className).toBe(styles.root);
  expect(main.parentElement?.className).toBe(styles.surface);
  expect(main.parentElement?.contains(screen.getByRole('heading', {name: '全球股市，年度规模矩阵。'}))).toBe(true);
  expect(main.parentElement?.contains(screen.getByRole('heading', {name: '口径、时间与授权'}))).toBe(true);
  const css = readFileSync('components/equity/equity.module.css', 'utf8');
  const surface = css.match(/\.surface\{([^}]+)\}/)![1];
  expect(surface).toContain('min-height:100vh');
  expect(surface).toContain('background:#0b1320');
  expect(surface).not.toContain('max-width');
  expect(css).toContain('.root{max-width:1360px;');
  expect(css).not.toMatch(/(?:^|[},])\s*(?:html|body|:root)\b/);
});

it('keeps headings, notices and source notes readable against the owned surface', () => {
  const css = readFileSync('components/equity/equity.module.css', 'utf8');
  const surface = css.match(/\.surface\{[^}]*background:(#[a-f\d]{6})/i)![1];
  for (const selector of ['.intro h1', '.subtitle', '.notice', '.sources ul', '.sources dt']) {
    const block = css.slice(css.indexOf(`${selector}{`) + selector.length + 1).split('}')[0];
    const color = block.match(/(?:^|;)color:(#[a-f\d]{6})/i)![1];
    const contrast = (luminance(color) + .05) / (luminance(surface) + .05);
    expect(contrast, `${selector} contrast`).toBeGreaterThanOrEqual(4.5);
  }
});
