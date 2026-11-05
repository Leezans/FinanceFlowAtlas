/** Shared Kraken API error boundary for quotes and executed trades. */
export class KrakenError extends Error {
  constructor(readonly code: string, readonly denied = false, readonly retryAfterMs = 0) { super(code); }
}
export function krakenResult(payload: unknown, maximumKeys: number): Record<string, unknown> {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KrakenError('invalid_schema');
    return value as Record<string, unknown>;
  };
  const root = object(payload);
  if (!Array.isArray(root.error) || root.error.some(error => typeof error !== 'string')) throw new KrakenError('invalid_schema');
  if (root.error.length) {
    if (root.error.some(error => /rate limit|throttl|permission|denied|unavailable in|restricted/i.test(error))) throw new KrakenError('source_access_denied', true);
    throw new KrakenError('source_api_error');
  }
  const result = object(root.result), count = Object.keys(result).length;
  if (count === 0 || count > maximumKeys) throw new KrakenError('source_pair_budget');
  return result;
}
