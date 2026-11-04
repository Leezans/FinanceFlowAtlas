import {ashareHandler} from '@/lib/ashare/host';
export const dynamic='force-dynamic';
export async function GET(request:Request){return ashareHandler(request)}
