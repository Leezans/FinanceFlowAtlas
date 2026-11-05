import type {Metadata} from 'next';
import ForexWorkspace from '@/components/forex/ForexWorkspace';
export const metadata:Metadata={title:'Finance Flow Atlas · 外汇行情',description:'Bounded Kraken fiat spot matrix with minute checks, independent execution timestamps, and a separate optional ECB daily reference. Not wholesale FX or capital flows.'};
export default function ForexPage(){return <ForexWorkspace/>}
