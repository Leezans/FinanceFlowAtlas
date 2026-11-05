import {cftcHandler} from '@/lib/futures/host';
export const dynamic='force-dynamic';
export async function GET(request:Request){return cftcHandler(request);}
