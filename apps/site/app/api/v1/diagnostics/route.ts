import {env} from 'cloudflare:workers';
import {createDiagnosticsHandler, type ReadOnlyD1} from '@/lib/diagnostics/handler';
export const dynamic = 'force-dynamic';
// Reuse the existing owner-private host and primary D1. No new access path.
export const GET = createDiagnosticsHandler(env.DB as unknown as ReadOnlyD1);
