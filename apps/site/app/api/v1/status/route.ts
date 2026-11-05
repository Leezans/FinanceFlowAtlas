export const dynamic='force-dynamic';
export async function GET(){return Response.json({state:'empty',last_attempt:null,last_success:null,next_due:null,error:'IMF 持仓尚未接入此托管预览。持仓不是本地市场资金流，不以美国 TIC 替代。',snapshot_version:null},{headers:{'Cache-Control':'no-store'}})}
