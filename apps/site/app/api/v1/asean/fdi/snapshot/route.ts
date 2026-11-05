import {aseanHandler} from '@/lib/asean/host';
export const dynamic='force-dynamic';
export async function GET(request:Request){return aseanHandler(request);}
