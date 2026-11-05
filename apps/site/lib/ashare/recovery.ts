/** Public, bounded diagnostics only. Never render upstream bodies or exception text. */
const STOPPED = new Set([
 'source_access_denied','persistent_source_denial','source_denied','source_denial_latched',
 'source_gate_release_unconfirmed','invalid_source_lease','html_challenge','non_json_challenge',
 'redirect_denied','automatic_redirect_denied','provider_error_or_challenge',
]);
const STORAGE = new Set(['source_gate_required','source_gate_unavailable','source_stale_lease']);
const VALIDATION = new Set(['byte_budget','invalid_schema','invalid_json','row_budget','unstable_total',
 'incomplete_page','duplicate_id','incomplete_snapshot','invalid_row','missing_fields','invalid_id',
 'invalid_name','invalid_numeric','negative_price','invalid_return','missing_snapshot']);
const TRANSPORT = new Set(['upstream_http','not_json','unsupported_content_encoding','transport_or_encoding_failure',
 'aborted','source_aborted','deadline','collection_failed','not_yet_acquired']);
export function safeSourceCode(value:unknown):string|null {
 return typeof value==='string' && (STOPPED.has(value)||STORAGE.has(value)||VALIDATION.has(value)||TRANSPORT.has(value)||
 ['source_busy','source_cooldown','runtime_routing_unverified','disabled','browser_network'].includes(value)) ? value : null;
}
export function isSourceStopped(code:string):boolean {return STOPPED.has(code)||code==='disabled';}
export function describeRecovery(code:string):{stage:string;message:string;action:string} {
 if(STOPPED.has(code))return {stage:'来源访问 / 安全校验',message:'来源访问已停止。',action:code==='source_gate_release_unconfirmed'||code==='invalid_source_lease'
  ?'采集租约状态未能确认，需要维护者核查；不会重置租约或继续采集。'
  :'请核查来源访问许可；不会自动重试、切换来源地址或绕过限制。'};
 if(STORAGE.has(code))return {stage:'采集协调存储',message:'数据协调存储尚未就绪，请检查数据库迁移。',action:'维护者需核查 D1 绑定与 ashare_source_gate 迁移；不要清空锁或拒绝记录。'};
 if(code==='runtime_routing_unverified')return {stage:'运行环境',message:'当前运行环境的来源连接未通过校验。',action:'维护者需核对受支持的 Workers 原生连接；不要改用代理绕过限制。'};
 if(code==='source_busy')return {stage:'采集协调',message:'另一项数据采集仍在进行，请稍后重试。',action:'等待现有采集结束；若持续占用，请维护者核查，不能抢占租约。'};
 if(code==='source_cooldown')return {stage:'来源限速',message:'来源限速等待中，请稍后重试。',action:'等待冷却结束，重试仍受服务端限速约束。'};
 if(code==='unsupported_content_encoding')return {stage:'传输解码',message:'来源返回不支持的内容编码，传输校验未通过。',action:'维护者需核对来源内容编码与 Workers 解码结果。'};
 if(VALIDATION.has(code))return {stage:'完整性校验',message:'来源数据未通过完整性校验。',action:'没有发布部分分页或无效行；重试会重新核对完整快照。'};
 if(code==='browser_network')return {stage:'浏览器到应用',message:'本次连接失败，尚未确认来源状态。',action:'检查当前网络连接；恢复后可在同一页面重试。'};
 if(code==='disabled')return {stage:'展示权限',message:'来源展示权限未建立，已清空缓存数据',action:'需先恢复合法展示权限。'};
 return {stage:'来源连接',message:code==='deadline'||code==='aborted'||code==='source_aborted'
  ?'请求中断或超时，尚未取得完整数据。':'来源连接失败，尚未取得新的完整快照。',action:'等待冷却结束后重试；不会补造行情或切换未经许可的来源。'};
}
