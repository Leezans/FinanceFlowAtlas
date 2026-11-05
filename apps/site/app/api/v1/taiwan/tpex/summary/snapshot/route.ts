import {tpexSummaryHandler} from '@/lib/national/tpex-summary-host';
export const dynamic='force-dynamic';
export async function GET(request:Request){return tpexSummaryHandler(request);}
