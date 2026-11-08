// @vitest-environment jsdom
import React from 'react';
import {Blob as NodeBlob} from 'node:buffer';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import OrganizedAshareEvidence from '../components/ashare/OrganizedAshareEvidence';
import OrganizedAshareReportEvidence from '../components/evidence/OrganizedAshareReportEvidence';
import {consumeReply, emptyState, type EvidenceState} from '../components/ashare/client';
import {projectAshareReport} from '../lib/evidence/ashare-projection';
import {ASHARE_REPORT_NOW as NOW, ASHARE_REPORT_ROOT as ROOT, ashareReportFixture} from './organized-ashare-fixture';

vi.mock('../lib/evidence/ashare-projection', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/evidence/ashare-projection')>();
  return {...original, projectAshareReport: vi.fn(original.projectAshareReport)};
});

const project = vi.mocked(projectAshareReport);
const files = new Map<string, Blob>();
const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();
const link = () => screen.queryByRole('link', {name: '下载整理后的 JSON', hidden: true});
const tick = () => act(() => vi.advanceTimersByTimeAsync(1));
// The wrapper first samples its clock; file preparation is a separate effect.
const prepare = async () => { await tick(); await tick(); };
const ready = (): EvidenceState => ({...emptyState(), status: 'ready', snapshot: ashareReportFixture()});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  project.mockClear();
  files.clear();
  let sequence = 0;
  createObjectURL.mockReset().mockImplementation(blob => {
    const url = `blob:ashare-${++sequence}`;
    files.set(url, blob);
    return url;
  });
  revokeObjectURL.mockReset().mockImplementation(url => { files.delete(url); });
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('A-share evidence work follows report identity', () => {
  it('does no projection, serialization or URI encoding for unchanged evidence on rerenders and resume', async () => {
    const state = ready();
    const view = render(<OrganizedAshareEvidence state={state} scope={ROOT}/>);
    await prepare();
    const originalHref = link()!.getAttribute('href');
    project.mockClear();
    const stringify = vi.spyOn(JSON, 'stringify');
    const encode = vi.spyOn(globalThis, 'encodeURIComponent');

    // New controller objects and equivalent scopes do not change the report.
    view.rerender(<OrganizedAshareEvidence state={{...state, message: 'unchanged evidence'}} scope={{...ROOT}}/>);
    view.rerender(<OrganizedAshareEvidence state={consumeReply(state, {status: 304}, ROOT, NOW + 1)} scope={ROOT}/>);
    for (const event of ['focus', 'pageshow', 'visibilitychange']) {
      vi.setSystemTime(Date.now() + 1_000);
      fireEvent(event === 'visibilitychange' ? document : window, new Event(event));
    }
    await prepare();

    // Scope-key serialization is constant-sized and is not report serialization.
    const reportSerializations = stringify.mock.calls.filter(([value]) => value?.source_id === 'eastmoney-ashare');
    const reportEncodings = encode.mock.calls.filter(([value]) => String(value).includes('organized-market-report/1'));
    expect.soft(project).not.toHaveBeenCalled();
    expect.soft(reportSerializations).toHaveLength(0);
    expect.soft(reportEncodings).toHaveLength(0);
    expect(link()!.getAttribute('href')).toBe(originalHref);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('defers the full report serialization and produces exact legacy JSON bytes without URI encoding', async () => {
    const snapshot = ashareReportFixture();
    snapshot.rows[0].provider_extra = {private: 'must not leave the allowlist'};
    const report = projectAshareReport(snapshot)!;
    const legacyBytes = JSON.stringify(report, null, 2);
    const stringify = vi.spyOn(JSON, 'stringify');
    const encode = vi.spyOn(globalThis, 'encodeURIComponent');
    render(<OrganizedAshareReportEvidence report={report}/>);

    expect.soft(stringify.mock.calls.filter(([value]) => value === report)).toHaveLength(0);
    expect.soft(encode).not.toHaveBeenCalled();
    expect.soft(link()).toBeNull();
    await prepare();
    expect(stringify.mock.calls.filter(([value]) => value === report)).toHaveLength(1);
    expect(encode).not.toHaveBeenCalled();
    const blob = files.get(link()!.getAttribute('href')!)!;
    expect(blob.type).toBe('application/json;charset=utf-8');
    expect(await blob.text()).toBe(legacyBytes);
    expect(legacyBytes).not.toContain('must not leave the allowlist');
  });

  it('rebuilds only when the visible snapshot or retained-stale meaning changes', async () => {
    let state = ready();
    const view = render(<OrganizedAshareEvidence state={state} scope={ROOT}/>);
    await prepare();
    const originalHref = link()!.getAttribute('href');
    project.mockClear();

    state = consumeReply(state, {status: 503, errorCode: 'upstream_http', recoveryMode: 'retry'}, ROOT, NOW + 1);
    view.rerender(<OrganizedAshareEvidence state={state} scope={ROOT}/>);
    expect(link()).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(originalHref);
    await prepare();
    expect(project).toHaveBeenCalledTimes(1);
    const staleHref = link()!.getAttribute('href');

    state = consumeReply(state, {status: 503, errorCode: 'collection_in_progress', recoveryMode: 'retry'}, ROOT, NOW + 2);
    view.rerender(<OrganizedAshareEvidence state={state} scope={ROOT}/>);
    await prepare();
    expect(project).toHaveBeenCalledTimes(1);
    expect(link()!.getAttribute('href')).toBe(staleHref);

    state = consumeReply(state, {status: 304}, ROOT, NOW + 3);
    view.rerender(<OrganizedAshareEvidence state={state} scope={ROOT}/>);
    expect(link()).toBeNull();
    await prepare();
    expect(project).toHaveBeenCalledTimes(2);
    // Deep equality does not permit a new snapshot to reuse an old file.
    view.rerender(<OrganizedAshareEvidence state={{...state, snapshot: ashareReportFixture()}} scope={ROOT}/>);
    expect(link()).toBeNull();
    await prepare();
    expect(project).toHaveBeenCalledTimes(3);
    expect(createObjectURL).toHaveBeenCalledTimes(4);
    view.unmount();
    expect(files.size).toBe(0);
    expect(revokeObjectURL).toHaveBeenCalledTimes(4);
  });
});
