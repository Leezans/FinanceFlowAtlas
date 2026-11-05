import {japanMofHandler} from '@/lib/japan/host';
export const dynamic='force-dynamic';
export async function GET(request:Request){return japanMofHandler(request);}
