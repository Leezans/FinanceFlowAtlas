// Compatibility factory for callers selecting options. Acquisition always uses
// the complete shared provider, never an independent options source fetcher.
import {createTaifexProvider,type TaifexProviderOptions} from '../../taifex/handler';
export type {TaifexGate,TaifexGateState,TaifexOutcome} from '../../taifex/handler';
export const createTaifexHandler=(options:TaifexProviderOptions)=>createTaifexProvider(options).optionsHandler;
