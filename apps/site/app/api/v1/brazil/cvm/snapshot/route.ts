import {cvmHandler} from '@/lib/cvm/host';
export const dynamic='force-dynamic';
export async function GET(request:Request){return cvmHandler(request);}
