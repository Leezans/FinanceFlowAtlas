// @vitest-environment jsdom
import React from 'react';
import { Blob } from 'node:buffer';
import { createHash } from 'node:crypto';
import baseline from './fixtures/organized-evidence-views.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import OrganizedEvidence from '../components/evidence/OrganizedEvidence';
import {
  projectJapanReport,
  projectTaiwanReport,
} from '../lib/evidence/report-projection';
import { projectAshareReport } from '../lib/evidence/ashare-projection';
import { projectTpexShareReport } from '../lib/evidence/tpex-share-projection';
import { projectCvmReport } from '../lib/evidence/cvm-projection';
import { projectCftcReport } from '../lib/evidence/cftc-projection';
import { japanFixture } from './japan-mof-ui-fixture';
import { summaryFixture } from './national-summary-fixture';
import { ashareReportFixture } from './organized-ashare-fixture';
import { tpexShareSnapshot } from './organized-tpex-fixture';
import { cvmSnapshot, manyCvmSecurities } from './organized-cvm-fixture';
import { reply, legacyReply } from './cftc-fixture';

// Captured before the view extraction at 28b13ba. The digest covers all DOM
// labels, cell order, attributes and filenames, plus exact exported JSON bytes.
// Only layout whitespace and the synthetic Blob URL are normalized.
const expectedViews: Record<string, unknown> = baseline;
const files = new Map<string, Blob>();
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const markup = (element: HTMLElement) =>
  hash(element.innerHTML.replace(/\s+/g, ' ').replace(/>\s+</g, '><'));
const manyCompanies = tpexShareSnapshot();
manyCompanies.rows = Array.from({ length: 12 }, (_, index) => ({
  ...manyCompanies.rows[0],
  code: String(2000 + index),
}));
manyCompanies.source_security_count =
  12 + manyCompanies.excluded_security_count;
const cases = [
  {
    name: 'japan',
    make: (stale: boolean) =>
      projectJapanReport(japanFixture().snapshot, stale),
  },
  {
    name: 'tpex-money',
    make: (stale: boolean) =>
      projectTaiwanReport(summaryFixture().snapshot, stale),
  },
  {
    name: 'ashare-industry',
    make: (stale: boolean) => projectAshareReport(ashareReportFixture(), stale),
  },
  {
    name: 'ashare-constituents',
    make: (stale: boolean) =>
      projectAshareReport(
        ashareReportFixture({
          scope: {
            kind: 'industry_stocks',
            fs: 'b:BK9000',
            classification_level: 'unknown_may_mix_levels',
          },
        }),
        stale,
      ),
  },
  {
    name: 'tpex-shares',
    make: (stale: boolean) =>
      projectTpexShareReport(tpexShareSnapshot(), stale),
  },
  {
    name: 'tpex-shares-bounded',
    make: (stale: boolean) => projectTpexShareReport(manyCompanies, stale),
  },
  {
    name: 'cvm',
    make: (stale: boolean) => projectCvmReport(cvmSnapshot(), stale),
  },
  {
    name: 'cvm-bounded',
    make: (stale: boolean) => projectCvmReport(manyCvmSecurities(41), stale),
  },
  {
    name: 'cftc-current-bounded',
    make: (stale: boolean) => projectCftcReport(reply().snapshot, stale),
  },
  {
    name: 'cftc-legacy',
    make: (stale: boolean) => projectCftcReport(legacyReply().snapshot, stale),
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  files.clear();
  vi.stubGlobal('Blob', Blob);
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: (blob: Blob) => {
        files.set('blob:synthetic-evidence', blob);
        return 'blob:synthetic-evidence';
      },
      revokeObjectURL: (url: string) => files.delete(url),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(cases)('$name view behavior', ({ name, make }) => {
  it.each([false, true])(
    'preserves pre-extraction markup and bytes (stale=%s)',
    async (stale) => {
      const report = make(stale)!;
      const guard = vi.fn<React.MouseEventHandler<HTMLAnchorElement>>((event) =>
        event.preventDefault(),
      );
      const { container } = render(
        <OrganizedEvidence report={report} onDownload={guard} />,
      );
      const preparing = markup(container);
      expect(container.querySelector('details')!.open).toBe(false);
      await act(() => vi.advanceTimersByTimeAsync(1));
      const link = container.querySelector<HTMLAnchorElement>('a[download]')!;
      const href = link.getAttribute('href')!;
      const json = href.startsWith('blob:')
        ? await files.get(href)!.text()
        : decodeURIComponent(href.slice(href.indexOf(',') + 1));
      expect(json).toBe(JSON.stringify(report, null, 2));
      expect(fireEvent.click(link)).toBe(false);
      expect(guard).toHaveBeenCalledOnce();
      const result = {
        preparing,
        ready: markup(container),
        json: hash(json),
        filename: link.download,
        previewRows: container.querySelectorAll('tbody tr').length,
      };
      const key = `${name}:${stale ? 'stale' : 'ready'}`;
      expect(result).toEqual(expectedViews[key]);
    },
  );
});

it('renders no panel or file when the caller withdraws the report', () => {
  const { container } = render(<OrganizedEvidence report={null} />);
  expect(container.innerHTML).toBe('');
  expect(vi.getTimerCount()).toBe(0);
});

it('withdraws an already prepared file immediately when the report becomes null', async () => {
  const report = projectCvmReport(cvmSnapshot())!;
  const { container, rerender } = render(<OrganizedEvidence report={report} />);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(container.querySelector('a[download]')).not.toBeNull();
  expect(files.size).toBe(1);
  rerender(<OrganizedEvidence report={null} />);
  expect(container.innerHTML).toBe('');
  expect(files.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
