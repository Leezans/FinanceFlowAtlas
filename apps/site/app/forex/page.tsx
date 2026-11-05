import type {Metadata} from 'next';
import Forex from '@/components/forex/Forex';
export const metadata:Metadata={title:'Finance Flow Atlas · 外汇参考',description:'ECB daily exchange-rate references with source dates and clearly labelled cross-rate calculations, not capital flows or live prices.'};
export default function ForexPage(){return <Forex/>}
