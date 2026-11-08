import React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';
import OrganizedEvidence, {
  type OrganizedEvidenceReport,
} from '../components/evidence/OrganizedEvidence';
import OrganizedMonetaryEvidence from '../components/evidence/OrganizedMonetaryEvidence';
import OrganizedAshareReportEvidence from '../components/evidence/OrganizedAshareReportEvidence';
import OrganizedTpexShareEvidence from '../components/evidence/OrganizedTpexShareEvidence';
import OrganizedCvmEvidence from '../components/evidence/OrganizedCvmEvidence';
import OrganizedCftcEvidence from '../components/evidence/OrganizedCftcEvidence';
import OrganizedDeribitEvidence from '../components/evidence/OrganizedDeribitEvidence';
import OrganizedKrakenTradeEvidence from '../components/evidence/OrganizedKrakenTradeEvidence';
import OrganizedPolymarketEvidence from '../components/evidence/OrganizedPolymarketEvidence';
import OrganizedPolymarketInterestEvidence from '../components/evidence/OrganizedPolymarketInterestEvidence';
import type { EvidenceRow } from '../lib/evidence/types';
import type {
  EvidenceRow as CompatibilityRow,
  OrganizedReport,
} from '../lib/evidence/report-projection';
import type { OrganizedAshareReport } from '../lib/evidence/ashare-projection';
import type { OrganizedTpexShareReport } from '../lib/evidence/tpex-share-projection';
import type { OrganizedCvmReport } from '../lib/evidence/cvm-projection';
import type { OrganizedCftcReport } from '../lib/evidence/cftc-projection';

function source(path: string) {
  const filename = resolve(process.cwd(), path);
  return ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}
function imports(path: string) {
  return source(path).statements.filter(ts.isImportDeclaration);
}
function runtimeImports(path: string) {
  return imports(path)
    .filter((declaration) => {
      const clause = declaration.importClause;
      if (!clause) return true;
      if (clause.isTypeOnly) return false;
      if (
        clause.name ||
        !clause.namedBindings ||
        ts.isNamespaceImport(clause.namedBindings)
      )
        return true;
      return clause.namedBindings.elements.some(
        (element) => !element.isTypeOnly,
      );
    })
    .map(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text,
    );
}

const routes = [
  ['japan-mof', OrganizedMonetaryEvidence],
  ['tpex-money', OrganizedMonetaryEvidence],
  ['eastmoney-ashare', OrganizedAshareReportEvidence],
  ['tpex-shares', OrganizedTpexShareEvidence],
  ['cvm-fund-equity', OrganizedCvmEvidence],
  ['cftc', OrganizedCftcEvidence],
  ['deribit-options', OrganizedDeribitEvidence],
  ['kraken-trades', OrganizedKrakenTradeEvidence],
  ['polymarket-gamma', OrganizedPolymarketEvidence],
  ['polymarket-open-interest', OrganizedPolymarketInterestEvidence],
] as const;

describe('organized evidence architecture boundaries', () => {
  it.each(routes)(
    'routes %s without interpreting report fields',
    (sourceId, View) => {
      // Only the discriminant is needed to route; validation and projection belong
      // to the caller. The dispatcher must pass the actual object and guard through.
      const report = Object.freeze({
        source_id: sourceId,
      }) as OrganizedEvidenceReport;
      const onDownload: React.MouseEventHandler<HTMLAnchorElement> = (event) =>
        event.preventDefault();
      const result = OrganizedEvidence({ report, onDownload });
      expect(result?.type).toBe(View);
      expect(result?.props).toEqual({ report, onDownload });
      expect(result?.props.report).toBe(report);
    },
  );

  it('uses only renderer dependencies at runtime in the dispatcher', () => {
    const dependencies = runtimeImports(
      'components/evidence/OrganizedEvidence.tsx',
    );
    expect(
      dependencies.every(
        (path) => path === 'react' || /^\.\/Organized\w+Evidence$/.test(path),
      ),
    ).toBe(true);
  });

  it('keeps local download mechanics independent of financial models and projections', () => {
    expect(
      runtimeImports('components/evidence/BlobEvidenceDownload.tsx').sort(),
    ).toEqual(['./evidence.module.css', 'react']);
    expect(
      imports('components/evidence/BlobEvidenceDownload.tsx').every(
        (declaration) => {
          const path = (declaration.moduleSpecifier as ts.StringLiteral).text;
          return path === 'react' || path === './evidence.module.css';
        },
      ),
    ).toBe(true);
  });

  it('defines shared row types without runtime code or source dependencies', () => {
    expect(
      source('lib/evidence/types.ts').statements.every(
        ts.isTypeAliasDeclaration,
      ),
    ).toBe(true);
    expectTypeOf<EvidenceRow>().toEqualTypeOf<CompatibilityRow>();
    const projections = readdirSync(
      resolve(process.cwd(), 'lib/evidence'),
    ).filter((path) => path.endsWith('-projection.ts'));
    let consumers = 0;
    for (const projection of projections) {
      for (const declaration of imports(`lib/evidence/${projection}`)) {
        const clause = declaration.importClause;
        if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings))
          continue;
        if (
          !clause.namedBindings.elements.some(
            (element) =>
              (element.propertyName ?? element.name).text === 'EvidenceRow',
          )
        )
          continue;
        consumers++;
        expect(
          (declaration.moduleSpecifier as ts.StringLiteral).text,
          projection,
        ).toBe('./types');
        expect(clause.isTypeOnly, projection).toBe(true);
      }
    }
    expect(consumers).toBeGreaterThan(0);
  });

  it('keeps each extracted view on its specific report contract', () => {
    expectTypeOf<
      React.ComponentProps<typeof OrganizedMonetaryEvidence>['report']
    >().toEqualTypeOf<OrganizedReport>();
    expectTypeOf<
      React.ComponentProps<typeof OrganizedAshareReportEvidence>['report']
    >().toEqualTypeOf<OrganizedAshareReport>();
    expectTypeOf<
      React.ComponentProps<typeof OrganizedTpexShareEvidence>['report']
    >().toEqualTypeOf<OrganizedTpexShareReport>();
    expectTypeOf<
      React.ComponentProps<typeof OrganizedCvmEvidence>['report']
    >().toEqualTypeOf<OrganizedCvmReport>();
    expectTypeOf<
      React.ComponentProps<typeof OrganizedCftcEvidence>['report']
    >().toEqualTypeOf<OrganizedCftcReport>();
  });
});
