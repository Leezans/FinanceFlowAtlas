import {krakenHandler} from '@/lib/crypto/host';
export const dynamic='force-dynamic';
export async function GET(request:Request){return krakenHandler(request);}
