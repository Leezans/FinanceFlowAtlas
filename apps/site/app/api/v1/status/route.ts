export const dynamic='force-dynamic';
export async function GET(){return Response.json({state:'empty',last_attempt:null,last_success:null,next_due:null,error:'IMF 尚未接入此托管预览；请使用 TIC 月度净交易层。',snapshot_version:null},{headers:{'Cache-Control':'no-store'}})}
