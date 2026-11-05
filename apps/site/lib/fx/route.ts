import {fxService} from './service';
export async function serveFx(){
 const result=await fxService.read();
 return Response.json(result,{status:result.snapshot?200:503,headers:{'Cache-Control':'private, no-store','X-Data-Concept':'exchange-rate-reference','X-Data-Status':result.source_state,...(result.source_state==='stale'?{Warning:'110 - "Last validated ECB reference rates; source refresh failed"'}:{})}});
}
