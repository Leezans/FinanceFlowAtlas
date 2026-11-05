import {sinaIndustryHandler} from '@/lib/sina/host';
export const dynamic='force-dynamic';
export async function GET(request: Request){return sinaIndustryHandler(request);}
