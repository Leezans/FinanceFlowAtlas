import {statusHeaders} from './status-headers';
import {getTic} from './cache';
import {repository} from './d1';
import {sha256} from './adapter';
export async function serveTic(request:Request,mode:'snapshot'|'status'){
 try{
  const {snapshot,status}=await getTic(repository());
  if(mode==='status')return Response.json(status,{headers:{'Cache-Control':'no-store',...statusHeaders(status)}});
  if(!snapshot)return Response.json({detail:'No validated hosted TIC snapshot. '+(status.error||'A public-source check is pending.'),...status},{status:503,headers:{'Cache-Control':'no-store',...statusHeaders(status)}});
  const etag='"'+(await sha256(snapshot.version+':'+snapshot.retrieved_at+':'+status.state)).slice(0,32)+'"';
  const headers:Record<string,string>={...statusHeaders(status),'ETag':etag,'Cache-Control':'no-cache','X-Data-Status':status.state};
  if(status.state!=='available')headers.Warning='110 - "Last validated TIC snapshot; source check is stale or failed"';
  if(request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers});
  return Response.json(snapshot,{headers});
 }catch{return Response.json(mode==='status'?{state:'unavailable',last_checked_at:null,error:'Hosted cache is unavailable. No simulated data is displayed.',source_status:'coordination_unavailable',next_retry_at:null}:{detail:'Hosted TIC cache is unavailable.',source_status:'coordination_unavailable',next_retry_at:null},{status:503,headers:{'Cache-Control':'no-store','X-Source-Status':'coordination_unavailable'}})}
}
