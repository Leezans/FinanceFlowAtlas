/** Native workerd + D1, synthetic fixtures only. External networking disabled. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), wr = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, createFetchMock } = wr('miniflare'), { build } = wr('esbuild');
const root = fileURLToPath(new URL('..', import.meta.url));
const { outputFiles } = await build({ stdin: { contents: `
 import {NewsService} from './lib/news/service';
 import {D1NewsGate,NEWS_GATE_SQL} from './lib/news/source-gate';
 import {NEWS_SOURCES} from './lib/news/sources';
 import {sourceBody} from './tests/news-ingestion-fixture';
 let calls=0,writes=0;
 export default {async fetch(request,env){
 const u=new URL(request.url),mode=u.searchParams.get('mode')||'ok',fault=u.searchParams.get('fault');
 if(u.pathname==='/stats')return Response.json({calls,writes});
 const db=mode==='missing-db'?undefined:{prepare(sql){return {bind(...args){return {async run(){
 if(mode==='gate-hang')return new Promise(()=>{});
 const target=fault?.startsWith('acquire')?NEWS_GATE_SQL.acquire:NEWS_GATE_SQL.finish;
 if(sql===target){writes++;if(fault?.endsWith('before'))throw new Error('synthetic pre-execution failure');}
 const result=await env.DB.prepare(sql).bind(...args).run();
 if(sql===target&&fault?.endsWith('after'))throw new Error('synthetic committed acknowledgment loss');
 return result;
 }}}}}};
 const gate=new D1NewsGate(db);
 if(u.pathname==='/stale'){
 const lease=await gate.acquire(NEWS_SOURCES[0]);
 let code;try{await gate.release(NEWS_SOURCES[0],{token:'wrong'}, {kind:'denied',error:'synthetic'});}catch(e){code=e.code;}
 return Response.json({code,lease});
 }
 const fetcher=async url=>{calls++;
 if(mode==='late') {await new Promise(r=>setTimeout(r,8100));return new Response('late denial',{status:403});}
 if(mode==='body')return new Response(new ReadableStream({pull:()=>new Promise(()=>{})}));
 if(mode==='excessive')return new Response('',{status:429,headers:{'retry-after':'99999999999999999999999999999'}});
 if(mode==='slow')await new Promise(r=>setTimeout(r,100));
 if(mode==='denied')return new Response('denied',{status:403});
 if(mode==='skew')return new Response('',{status:503,headers:{'retry-after':new Date(Date.now()+3600000).toUTCString()}});
 if(mode==='retry')return new Response('',{status:429,headers:{'retry-after':'3600'}});
 return new Response(sourceBody(String(url)));
 };
 return Response.json(await new NewsService(fetcher,()=>new Date(Date.now()+(mode==='skew'?3*86400000:0)),gate).snapshot());
 }};`, resolveDir: root, sourcefile: 'news-offline-worker.ts' }, bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module','main'], target: 'es2022', external: ['cloudflare:workers'], write: false });
const mock=createFetchMock();mock.disableNetConnect();
const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'offline-news'},fetchMock:mock});
const mf=new Miniflare({workers:['warm','cold','third'].map(worker)});
const url='https://app.invalid/';
try {
 const db=await mf.getD1Database('DB','warm');
 const workers=await Promise.all(['warm','cold','third'].map(n=>mf.getWorker(n)));
 const get=async(i=0,query='')=>(await workers[i].fetch(url+query)).json();
 const stats=async()=>{const all=await Promise.all(workers.map(w=>w.fetch(url+'stats').then(r=>r.json())));return all.reduce((a,b)=>({calls:a.calls+b.calls,writes:a.writes+b.writes}),{calls:0,writes:0});};
 const rows=async()=>(await db.prepare('SELECT * FROM news_source_gate ORDER BY id').all()).results;
 const reset=async()=>db.prepare("UPDATE news_source_gate SET status='idle',lease_token=NULL,payload=NULL,error_text=NULL,attempted_ms=0,updated_ms=0,not_before_ms=0").run();
 assert.equal((await get()).status,'unavailable');assert.equal((await stats()).calls,0);
 const migrations=(await readdir(new URL('../drizzle/',import.meta.url))).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
 for(const name of migrations.filter(n=>!n.startsWith('0024_')))for(const sql of (await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r=>r.name);
 const before=await Promise.all(tables.map(t=>db.prepare('SELECT * FROM '+t).all()));
 for(const sql of (await readFile(new URL('../drizzle/0024_news_source_gate.sql',import.meta.url),'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 assert.equal((await rows()).length,6);
 assert.equal((await get(0,'?mode=missing-db')).status,'unavailable');assert.equal((await stats()).calls,0);
 console.log('PASS missing DB/schema fail closed; all migrations seed six sources');
 await Promise.all(workers.map((_,i)=>get(i,'?mode=slow')));assert.equal((await stats()).calls,6);
 assert.ok((await rows()).every(r=>r.status==='idle'&&r.payload));
 await get(1);assert.equal((await stats()).calls,6);
 console.log('PASS cross-isolate race admits exactly one request/source and reuses D1 cache');
 await db.prepare('UPDATE news_source_gate SET not_before_ms=0').run();await get(1,'?mode=denied');
 assert.ok((await rows()).every(r=>r.status==='blocked'&&r.payload===null));
 const denied=await get();assert.equal(denied.status,'unavailable');assert.equal(denied.news.length,0);assert.ok(denied.sources.every(s=>s.halted));assert.equal((await stats()).calls,12);
 console.log('PASS denial durable across workers and suppresses previously cached evidence');
 await reset();await db.prepare("UPDATE news_source_gate SET status='busy',lease_token='lost-worker',attempted_ms=1").run();await get();await get(1);assert.equal((await stats()).calls,12);assert.ok((await rows()).every(r=>r.status==='busy'));
 console.log('PASS old busy lease never expires or permits takeover');
 await reset();assert.equal((await get(0,'stale')).code,'source_stale_lease');assert.equal((await rows()).find(r=>r.id==='fed-press').status,'busy');
 console.log('PASS wrong-token release cannot overwrite owned lease');
 for(const target of ['acquire','release'])for(const phase of ['before','after']){
 await reset();const initial=await stats();const result=await get(0,'?fault='+target+'-'+phase);
 assert.equal(result.status,'unavailable');const end=await stats();assert.equal(end.calls-initial.calls,target==='acquire'?0:6);assert.equal(end.writes-initial.writes,6);
 assert.ok((await rows()).every(r=>r.status===(target==='acquire'?(phase==='before'?'idle':'busy'):(phase==='before'?'busy':'idle'))));
 if(target==='acquire'&&phase==='after'||target==='release'&&phase==='before'){await get(1);assert.equal((await stats()).calls,end.calls);}
 if(target==='release'&&phase==='after'){await get(1);assert.equal((await stats()).calls,end.calls);}
 console.log('PASS '+target+' acknowledgment loss '+phase+': no retry or unconfirmed publication');
 }
 await reset();await get();await db.prepare('UPDATE news_source_gate SET not_before_ms=0').run();
 const denialBefore=await stats();await get(0,'?mode=denied&fault=release-after');
 assert.ok((await rows()).every(r=>r.status==='blocked'&&r.payload===null));
 const recoveredDenial=await get(1);assert.ok(recoveredDenial.sources.every(s=>s.halted));assert.equal(recoveredDenial.news.length,0);assert.equal((await stats()).calls-denialBefore.calls,6);
 console.log('PASS committed denial with lost acknowledgment still suppresses cache and retries');
 await reset();const initial=await stats();await get(0,'?mode=retry');await get(1);assert.equal((await stats()).calls-initial.calls,6);assert.ok((await rows()).every(r=>r.not_before_ms>Date.now()+3500000));
 console.log('PASS shared one-hour Retry-After cooldown');
 await reset();const skewStart=Date.now();await get(0,'?mode=skew');assert.ok((await rows()).every(r=>r.not_before_ms>skewStart+3500000&&r.not_before_ms<skewStart+3700000));
 console.log('PASS HTTP-date Retry-After uses database time despite three-day isolate clock skew');

 for(const mode of ['late','body','excessive','gate-hang']){
 await reset();const initial=await stats(),started=Date.now();const result=await get(0,'?mode='+mode);
 assert.equal(result.status,'unavailable');assert.ok(Date.now()-started<12000,'response bounded');
 assert.equal((await stats()).calls-initial.calls,mode==='gate-hang'?0:6);
 if(mode!=='gate-hang'){
 await new Promise(r=>setTimeout(r,250));assert.ok((await rows()).every(r=>r.status==='busy'&&r.payload===null));
 await get(1);assert.equal((await stats()).calls-initial.calls,6);
 }
 console.log('PASS '+mode+': bounded response, no unsafe retry or cache publication');
 }
 for(let i=0;i<tables.length;i++)assert.deepEqual((await db.prepare('SELECT * FROM '+tables[i]).all()).results,before[i].results,tables[i]+' unchanged');
 console.log('PASS news migration and operations leave all existing tables untouched');
} finally {await mf.dispose();await mock.close();}
