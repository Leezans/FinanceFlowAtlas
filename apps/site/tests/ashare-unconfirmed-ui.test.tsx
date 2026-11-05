// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import EvidenceHeatmap from '../components/ashare/EvidenceHeatmap';
import SourceRecovery from '../components/ashare/SourceRecovery';
import {consumeReply,emptyState} from '../components/ashare/client';
import {describeRecovery} from '../lib/ashare/recovery';
import type {Scope} from '../components/ashare/model';
const scope:Scope={kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'};
afterEach(cleanup);
it('shows unresolved outcome in the matrix and does not invite futile waiting/retry',()=>{
 const state=consumeReply(emptyState(),{status:503,errorCode:'source_outcome_unconfirmed',recoveryMode:'stopped'},scope);
 const {container}=render(<><EvidenceHeatmap state={state}/><SourceRecovery state={state} scope={scope} loading={false} onRetry={vi.fn()}/></>);
 expect(screen.getByRole('heading',{name:'A股上次采集结果待核查'})).toBeTruthy();
 expect(container.textContent).toContain('上次采集未能确认结果，已停止自动重试。');
 expect(screen.queryByRole('button',{name:'重试当前来源'})).toBeNull();
 expect(container.textContent).not.toContain('矩阵已保留，等待可核验数据');
 expect(container.textContent).not.toContain('另一项数据采集仍在进行');
 expect(container.querySelectorAll('[data-id]')).toHaveLength(0);
 expect(container.querySelector('svg')).toBeNull();
 expect(describeRecovery('source_outcome_unconfirmed').stage).toBe('采集结果待核查');
});
