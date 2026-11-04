import http from 'node:http';
import worker from './worker/index.js';
http.createServer(async(req,res)=>{try{const r=await worker.fetch(new Request('http://localhost'+req.url));res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch(e){res.writeHead(500);res.end(String(e));}}).listen(process.env.PORT||3000,'0.0.0.0');
