import {serveFx} from '@/lib/fx/route';
import {fxService} from '@/lib/fx/host';
export const dynamic='force-dynamic';
export async function GET(){return serveFx(fxService)}
