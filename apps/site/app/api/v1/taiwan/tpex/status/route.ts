import {tpexHandler} from '@/lib/tpex/host';
export const dynamic='force-dynamic';
export async function GET(request:Request){return tpexHandler(request);}
