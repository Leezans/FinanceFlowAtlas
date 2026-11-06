import type {SourceGateView, SourceOutcome, TicSourceGate} from '../lib/tic/source-gate';
/** Shared synthetic source coordination. Never uses network or D1. */
export function memoryGate(): TicSourceGate {
 let gate:SourceGateView={state:'ready',retryAt:null,error:null,checkedAt:null};let owner:string|null=null;
 return {
  async ensure(){},
  async inspect(now){return {...gate,state:gate.state==='cooldown'&&(gate.retryAt??0)<=now?'ready':gate.state}},
  async claim(now,token){if(owner||!['ready','cooldown'].includes(gate.state)||(gate.retryAt??0)>now)return false;owner=token;gate={...gate,state:'checking',checkedAt:now};return true},
  async finish(token,outcome:SourceOutcome,now){if(owner!==token)throw new Error('stale source owner');owner=null;gate={...gate,state:outcome.state,retryAt:outcome.state==='cooldown'?Math.max(now+(outcome.delayMs??0),outcome.retryAtMs??0):null,error:outcome.error??null}},
 };
}
