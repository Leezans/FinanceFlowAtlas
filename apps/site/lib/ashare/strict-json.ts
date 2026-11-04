/** Reject duplicate keys, excessive nesting, malformed and nonfinite JSON. */
export function strictJSON(text: string): unknown {
  let i=0;
  const ws=()=>{while(/[\x20\t\r\n]/.test(text[i]??'!')) i++;};
  const fail=():never=>{throw new Error('invalid_json');};
  const string=():string=>{const start=i++;while(i<text.length){const c=text[i++];if(c==='"') return JSON.parse(text.slice(start,i));if(c==='\\') i++;}return fail();};
  function value(depth:number):unknown {
    if(depth>20) return fail(); ws(); const c=text[i];
    if(c==='"')return string();
    if(c==='{') {i++;ws();const out:Record<string,unknown>=Object.create(null);if(text[i]==='}'){i++;return out;}while(true){ws();if(text[i]!=='"')return fail();const key=string();if(Object.hasOwn(out,key))return fail();ws();if(text[i++]!==':')return fail();out[key]=value(depth+1);ws();const end=text[i++];if(end==='}')return out;if(end!==',')return fail();}}
    if(c==='['){i++;ws();const out:unknown[]=[];if(text[i]===']'){i++;return out;}while(true){out.push(value(depth+1));ws();const end=text[i++];if(end===']')return out;if(end!==',')return fail();}}
    for(const [token,v] of [['null',null],['true',true],['false',false]] as const){if(text.startsWith(token,i)){i+=token.length;return v;}}
    const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));
    if(!match)return fail();i+=match[0].length;const n=Number(match[0]);if(!Number.isFinite(n))return fail();return n;
  }
  const result=value(0);ws();if(i!==text.length)return fail();return result;
}
