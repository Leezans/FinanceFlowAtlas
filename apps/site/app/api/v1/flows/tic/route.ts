import {serveTic} from '@/lib/tic/route';
export const dynamic='force-dynamic';
export async function GET(request:Request){return serveTic(request,'snapshot')}
