/** Bounded, CRC-verified ZIP/Latin-1 CSV reader. No archive extraction. */
import {createInflateRaw} from 'node:zlib';
import {Readable} from 'node:stream';
const MAX_ZIP=40*1024*1024, MAX_MEMBER=70*1024*1024, MAX_TOTAL=120*1024*1024;
function fail():never{throw new Error('invalid_source_archive');}
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
type Member={name:string,method:number,size:number,compressed:number,crc:number,start:number};
export class CsvZip {
 private members=new Map<string,Member>();
 constructor(private bytes:Uint8Array,private budget={consumed:0}){
  if(bytes.length<22||bytes.length>MAX_ZIP)fail();
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=(p:number)=>v.getUint16(p,true),u32=(p:number)=>v.getUint32(p,true);
  let e=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(u32(p)===0x06054b50&&p+22+u16(p+20)===bytes.length){e=p;break;}
  if(e<0||u16(e+4)||u16(e+6)||u16(e+8)!==u16(e+10)||u16(e+10)>100||u16(e+10)===65535)fail();
  const end=u32(e+16)+u32(e+12);if(end!==e)fail();let p=u32(e+16);const ranges:[number,number][]=[];
  for(let i=0;i<u16(e+10);i++){
   if(p+46>end||u32(p)!==0x02014b50)fail();
   const flags=u16(p+8),method=u16(p+10),crc=u32(p+16),compressed=u32(p+20),size=u32(p+24),nl=u16(p+28),xl=u16(p+30),cl=u16(p+32),local=u32(p+42);
   if((flags&~(8|2048))||![0,8].includes(method)||size>MAX_MEMBER||compressed>MAX_ZIP||u16(p+34)||p+46+nl+xl+cl>end||local+30>u32(e+16))fail();
   const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(p+46,p+46+nl));
   if(!/^[A-Za-z0-9_.-]+\.csv$/.test(name)||this.members.has(name))fail();
   const checkExtra=(s:number,len:number)=>{let x=s;while(x<s+len){if(x+4>s+len)fail();const id=u16(x),l=u16(x+2);if(id===1||x+4+l>s+len)fail();x+=4+l;}};
   checkExtra(p+46+nl,xl);
   if(u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method)fail();
   const ln=u16(local+26),lx=u16(local+28),start=local+30+ln+lx;
   if(start+compressed>u32(e+16)||ln!==nl||new TextDecoder().decode(bytes.subarray(local+30,local+30+ln))!==name)fail();
   checkExtra(local+30+ln,lx);
   if(!(flags&8)&&(u32(local+14)!==crc||u32(local+18)!==compressed||u32(local+22)!==size))fail();
   if((flags&8)&&((u32(local+14)!==0&&u32(local+14)!==crc)||(u32(local+18)!==0&&u32(local+18)!==compressed)||(u32(local+22)!==0&&u32(local+22)!==size)))fail();
   let stop=start+compressed;
   if(flags&8){if(stop+12>u32(e+16))fail();if(u32(stop)===0x08074b50)stop+=4;if(stop+12>u32(e+16)||u32(stop)!==crc||u32(stop+4)!==compressed||u32(stop+8)!==size)fail();stop+=12;}
   if(ranges.some(([a,b])=>local<b&&stop>a))fail();ranges.push([local,stop]);
   this.members.set(name,{name,method,size,compressed,crc,start});p+=46+nl+xl+cl;
  }
  if(p!==end)fail();
 }
 async *csv(name:string,required:readonly string[],signal?:AbortSignal):AsyncGenerator<Record<string,string>>{
  signal?.throwIfAborted();
  const m=this.members.get(name);if(!m)fail();
  const bytes=this.bytes.subarray(m.start,m.start+m.compressed);
  const chunks=async function*(){for(let i=0;i<bytes.length;i+=16384){signal?.throwIfAborted();yield bytes.subarray(i,i+16384);}};
  const inflater=m.method===8?createInflateRaw():null;
  const input=Readable.from(chunks()),stream=inflater?input.pipe(inflater):input;
  if(stream!==input)input.on('error',error=>stream.destroy(error));
  const abort=()=>stream.destroy(new Error('source_aborted'));signal?.addEventListener('abort',abort,{once:true});
  let actual=0,crc=0xffffffff,field='',row:string[]=[],header:string[]|null=null,quoted=false,afterQuote=false,atStart=true,rows=0,skipLF=false;
  const emit=()=>{row.push(field);field='';atStart=true;if(!header){header=row;if(header.length>128||new Set(header).size!==header.length||required.some(x=>!header!.includes(x)))throw new Error('invalid_csv_header');row=[];return null;}if(row.length!==header.length)throw new Error('invalid_csv_row');if(++rows>400000)throw new Error('csv_limit');const out=Object.fromEntries(header.map((h,i)=>[h,row[i]]));row=[];return out;};
  try{
   for await(const chunk of stream){signal?.throwIfAborted();const b=chunk as Uint8Array;actual+=b.length;this.budget.consumed+=b.length;if(actual>m.size||actual>MAX_MEMBER||this.budget.consumed>MAX_TOTAL)fail();for(const x of b)crc=table[(crc^x)&255]^(crc>>>8);
    const s=new TextDecoder('windows-1252').decode(b);
    for(const c of s){
     if(skipLF){skipLF=false;if(c==='\n')continue;}
     if(quoted){if(c==='"'){quoted=false;afterQuote=true;}else field+=c;}
     else if(afterQuote&&c==='"'){quoted=true;afterQuote=false;field+='"';}
     else if(c===';'||c==='\n'||c==='\r'){afterQuote=false;if(c===';'){row.push(field);field='';atStart=true;}else{const out=emit();if(out)yield out;if(c==='\r')skipLF=true;}}
     else if(afterQuote)throw new Error('invalid_csv_quote');
     else if(c==='"'){if(atStart){quoted=true;atStart=false;}else field+=c;}
     else{field+=c;atStart=false;}
     if(field.length>16384||row.length>128)throw new Error('csv_limit');
    }
   }
   if(quoted)throw new Error('invalid_csv_quote');if(field.length||row.length||afterQuote){const out=emit();if(out)yield out;}
   if((inflater&&inflater.bytesWritten!==m.compressed)||!header||actual!==m.size||((crc^0xffffffff)>>>0)!==m.crc)fail();
  }finally{signal?.removeEventListener('abort',abort);stream.destroy();input.destroy();}
 }
}
