# Geography attribution

- The bundled country polygons are `world-atlas@2.0.2` countries-110m.json, distributed by Mike Bostock, derived from Natural Earth 1:110 million Admin 0 country boundaries. Natural Earth geographic data are public domain. Package: https://github.com/topojson/world-atlas. Natural Earth terms: https://www.naturalearthdata.com/about/terms-of-use/.
- The 249-entry searchable country/territory index uses ISO 3166-1 names and identifiers from the system iso-codes dataset. Geographic regions are cross-referenced against `world-countries` (https://github.com/mledoze/countries, ODbL) and emitted in components/atlas/countries.json. The region-enriched index is an attributed derivative dataset under ODbL; see https://opendatacommons.org/licenses/odbl/1-0/.
- Map geometries and searchable ISO entries have different coverage. At 1:110m many small territories have no polygon. The UI explicitly separates both counts and allows every ISO entry to be searched.
- Boundaries are illustrative and do not constitute an endorsement of any sovereignty claim. Equity observations must come from a validated backend snapshot; no fabricated observations are bundled.

The upstream iso-codes package is LGPL-2.1-or-later; its copyright notice and license text are preserved in licenses/ISO-CODES-NOTICE.txt and licenses/ISO-CODES-LGPL-2.1.txt. world-countries' database license is preserved in licenses/WORLD-COUNTRIES-LICENSE.txt. These data notices are separate from the repository's Apache-2.0 source-code license. The derived country index is published in editable JSON form with its source attribution.

## Hosted application dependencies

The Sites Vite plugin license is retained at `scripts/vite/sites-vite-plugin.LICENSE`. The vendored shadcn stylesheet license is retained at `vendor/shadcn-tailwind-4.13.0.LICENSE.md`. npm dependencies retain their own licenses; exact resolved versions and package license metadata are recorded in `package-lock.json`. Repository source licensing does not relicense dependency code or geographic/provider data.
