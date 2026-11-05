import {markets, type Market} from './model';

export const COUNTRY_CHANGE_EVENT = 'atlas-country-change';
export function selectedMarket(fallback: string | null = null): Market | null {
  const code = new URLSearchParams(window.location.search).get('country');
  return markets.find(market => market.iso3 === code) ?? markets.find(market => market.iso3 === fallback) ?? null;
}
/** Both country controls and the optional map share the URL, including Back/Forward. */
export function navigateToMarket(market: Market | null) {
  const url = new URL(window.location.href);
  if (market) url.searchParams.set('country', market.iso3);
  else url.searchParams.delete('country');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new Event(COUNTRY_CHANGE_EVENT));
}
