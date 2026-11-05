// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,act} from '@testing-library/react';
import EvidenceHeatmap from '../components/ashare/EvidenceHeatmap';
import {validateEvidence,type EvidenceSnapshot} from '../components/ashare/model';

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()});
it('lays out the treemap in actual pixels on narrow screens and responds to resizing',()=>{
 let width=314;let resize:ResizeObserverCallback=()=>{};
 const disconnect=vi.fn();
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(function(this:HTMLElement){return this.hasAttribute('data-layout')?width:0});
 vi.stubGlobal('ResizeObserver',class{constructor(callback:ResizeObserverCallback){resize=callback}observe(){}disconnect=disconnect});
 const data={schema:'ashare-provider-evidence/1',rows:[{f12:'BK0001',f14:'合成行业',f62:12500.25,f3:1.25,f2:null,f184:null,f66:null,f69:null,f72:null,f75:null,f78:null,f81:null,f84:null,f87:null}],source_total:1,fetched_at:'2026-11-04T08:00:00Z',scope:{kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'},page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:'index_points'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'仅合成测试',stale:false,has_error:false} as EvidenceSnapshot;
 const view=render(<EvidenceHeatmap state={{snapshot:validateEvidence(data),etag:'test',status:'ready',message:''}}/>);
 const svg=screen.getByRole('group',{name:'当前筛选范围的主力净额矩形热力图区块'});
 expect(svg.getAttribute('viewBox')).toBe('0 0 314 440');
 width=900;act(()=>resize([],{} as ResizeObserver));
 expect(screen.getByRole('group',{name:'当前筛选范围的主力净额矩形热力图区块'}).getAttribute('viewBox')).toBe('0 0 900 520');
 view.unmount();expect(disconnect).toHaveBeenCalledOnce();
});
