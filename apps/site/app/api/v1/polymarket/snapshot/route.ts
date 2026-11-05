import {polymarketHandler} from '@/lib/polymarket/host';
export const dynamic='force-dynamic';
export async function GET(request:Request){return polymarketHandler(request);}
