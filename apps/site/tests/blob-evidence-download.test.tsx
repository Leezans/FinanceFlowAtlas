// @vitest-environment jsdom
import React from 'react';
import {Blob as NodeBlob} from 'node:buffer';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import BlobEvidenceDownload from '../components/evidence/BlobEvidenceDownload';

const preparing = '正在准备本地 JSON…';
const failed = '无法准备本地 JSON，当前证据仍可在下表查看。';
const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();
const prepare = () => act(() => vi.runOnlyPendingTimers());
const link = () => screen.getByRole('link', {name: '下载整理后的 JSON'});

beforeEach(() => {
  vi.useFakeTimers();
  let sequence = 0;
  createObjectURL.mockReset().mockImplementation(() => `blob:report-${++sequence}`);
  revokeObjectURL.mockReset();
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('local evidence JSON download', () => {
  it('defers serialization and preserves exact JSON, native fields, null and zero', async () => {
    const native = {value: 0, missing: null, source: '原始资料'};
    const toJSON = vi.fn(() => ({native_snapshot: native, rows: [{value: null}, {value: 0}]}));
    render(<BlobEvidenceDownload report={{toJSON}} filename="evidence.json"/>);
    expect(screen.getByText(preparing)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(toJSON).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    prepare();
    expect(toJSON).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('application/json;charset=utf-8');
    expect(await blob.text()).toBe(JSON.stringify({native_snapshot: native, rows: [{value: null}, {value: 0}]}, null, 2));
    expect(link().getAttribute('href')).toBe('blob:report-1');
    expect(link().getAttribute('download')).toBe('evidence.json');
  });

  it('keeps the resource for the same identity while updating the filename', () => {
    const report = {value: 0};
    const view = render(<BlobEvidenceDownload report={report} filename="first.json"/>);
    prepare();
    view.rerender(<BlobEvidenceDownload report={report} filename="renamed.json"/>);
    prepare();
    expect(link().getAttribute('download')).toBe('renamed.json');
    expect(link().getAttribute('href')).toBe('blob:report-1');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('replaces a deeply equal new object without showing the previous URL', () => {
    const view = render(<BlobEvidenceDownload report={{rows: [{value: 0}]}} filename="report.json"/>);
    prepare();
    view.rerender(<BlobEvidenceDownload report={{rows: [{value: 0}]}} filename="report.json"/>);
    expect(screen.getByText(preparing)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:report-1');
    prepare();
    expect(link().getAttribute('href')).toBe('blob:report-2');
  });

  it('revokes every prepared replacement exactly once, including on unmount', () => {
    const view = render(<BlobEvidenceDownload report={{value: 1}} filename="report.json"/>);
    prepare();
    for (const value of [2, 3]) {
      view.rerender(<BlobEvidenceDownload report={{value}} filename="report.json"/>);
      expect(screen.queryByRole('link')).toBeNull();
      prepare();
    }
    view.unmount();
    expect(createObjectURL).toHaveBeenCalledTimes(3);
    expect(revokeObjectURL.mock.calls).toEqual([['blob:report-1'], ['blob:report-2'], ['blob:report-3']]);
  });

  it('cancels preparation when unmounted before the timer runs', () => {
    const toJSON = vi.fn(() => ({value: 0}));
    const view = render(<BlobEvidenceDownload report={{toJSON}} filename="report.json"/>);
    view.unmount();
    prepare();
    expect(toJSON).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('cancels pending replacements and prepares only the latest report', async () => {
    const view = render(<BlobEvidenceDownload report={{value: 1}} filename="report.json"/>);
    prepare();
    const cancelled = vi.fn(() => ({value: 2}));
    view.rerender(<BlobEvidenceDownload report={{toJSON: cancelled}} filename="report.json"/>);
    view.rerender(<BlobEvidenceDownload report={{value: 3}} filename="report.json"/>);
    prepare();
    expect(cancelled).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(await createObjectURL.mock.calls[1][0].text()).toBe(JSON.stringify({value: 3}, null, 2));
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:report-1');
  });

  const cyclic: {self?: object} = {};
  cyclic.self = cyclic;
  it.each([['BigInt', {value: BigInt(1)}], ['cyclic', cyclic]] as const)(
    'handles a %s report failure and revokes the preceding resource',
    (_name, invalidReport) => {
      const view = render(<BlobEvidenceDownload report={{value: 0}} filename="report.json"/>);
      prepare();
      view.rerender(<BlobEvidenceDownload report={invalidReport} filename="report.json"/>);
      expect(screen.queryByRole('link')).toBeNull();
      prepare();
      expect(screen.getByText(failed)).toBeTruthy();
      expect(screen.queryByRole('link')).toBeNull();
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:report-1');
      view.unmount();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    },
  );

  it('handles URL creation failure, revokes the previous resource and recovers', () => {
    const view = render(<BlobEvidenceDownload report={{value: 1}} filename="report.json"/>);
    prepare();
    createObjectURL.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    view.rerender(<BlobEvidenceDownload report={{value: 2}} filename="report.json"/>);
    prepare();
    expect(screen.getByText(failed)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:report-1');
    view.rerender(<BlobEvidenceDownload report={{value: 3}} filename="report.json"/>);
    prepare();
    expect(link().getAttribute('href')).toBe('blob:report-2');
  });

  it('rejects undefined serialization instead of offering invalid JSON bytes', () => {
    const view = render(<BlobEvidenceDownload report={{value: 0}} filename="report.json"/>);
    prepare();
    view.rerender(<BlobEvidenceDownload report={{toJSON: () => undefined}} filename="report.json"/>);
    expect(screen.queryByRole('link')).toBeNull();
    prepare();
    expect(screen.getByText(failed)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:report-1');
  });

  it('cancels the extra StrictMode preparation and cleans up its single resource', () => {
    const toJSON = vi.fn(() => ({value: 0}));
    const view = render(
      <React.StrictMode>
        <BlobEvidenceDownload report={{toJSON}} filename="report.json"/>
      </React.StrictMode>,
    );
    expect(toJSON).not.toHaveBeenCalled();
    prepare();
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(link().getAttribute('href')).toBe('blob:report-1');
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:report-1');
  });

  it('preserves the caller click guard and uses the latest handler without rebuilding', () => {
    const report = {value: 0};
    const first = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault());
    const latest = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault());
    const view = render(<BlobEvidenceDownload report={report} filename="report.json" onDownload={first}/>);
    prepare();
    expect(fireEvent.click(link())).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first.mock.calls[0][0].defaultPrevented).toBe(true);
    view.rerender(<BlobEvidenceDownload report={report} filename="report.json" onDownload={latest}/>);
    expect(fireEvent.click(link())).toBe(false);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
