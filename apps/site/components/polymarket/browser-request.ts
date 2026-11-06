/** Browser/application waiting only. This never changes a provider lease or backoff. */
export function untilAborted<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 let abort=()=>{};
 const stopped=new Promise<never>((_resolve,reject)=>{
  abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
 return Promise.race([operation,stopped]).finally(()=>signal.removeEventListener('abort',abort));
}
/** Preserve long server waits; cap individual timer chunks, never the deadline. */
export function timerDelay(deadline:number,now=Date.now()):number{return Math.max(0,Math.min(2_147_483_647,deadline-now));}
export function retryAfterDeadline(value:string|null,now=Date.now()):number{
 const text=value?.trim();if(!text)return 0;
 if(/^\d+$/.test(text))return now+Number(text)*1000;
 const date=Date.parse(text);return Number.isFinite(date)?Math.max(now,date):0;
}
