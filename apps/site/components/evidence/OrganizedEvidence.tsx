'use client';

import React from 'react';
import type { OrganizedReport } from '@/lib/evidence/report-projection';
import type { OrganizedAshareReport } from '@/lib/evidence/ashare-projection';
import type { OrganizedTpexShareReport } from '@/lib/evidence/tpex-share-projection';
import type { OrganizedCvmReport } from '@/lib/evidence/cvm-projection';
import type { OrganizedCftcReport } from '@/lib/evidence/cftc-projection';
import type { OrganizedDeribitReport } from '@/lib/evidence/deribit-projection';
import type { OrganizedKrakenTradeReport } from '@/lib/evidence/kraken-trade-projection';
import type { OrganizedPolymarketReport } from '@/lib/evidence/polymarket-projection';
import type { OrganizedPolymarketInterestReport } from '@/lib/evidence/polymarket-interest-projection';
import OrganizedMonetaryEvidence from './OrganizedMonetaryEvidence';
import OrganizedAshareReportEvidence from './OrganizedAshareReportEvidence';
import OrganizedTpexShareEvidence from './OrganizedTpexShareEvidence';
import OrganizedCvmEvidence from './OrganizedCvmEvidence';
import OrganizedCftcEvidence from './OrganizedCftcEvidence';
import OrganizedDeribitEvidence from './OrganizedDeribitEvidence';
import OrganizedKrakenTradeEvidence from './OrganizedKrakenTradeEvidence';
import OrganizedPolymarketEvidence from './OrganizedPolymarketEvidence';
import OrganizedPolymarketInterestEvidence from './OrganizedPolymarketInterestEvidence';

// Keep existing consumers' preview-limit imports compatible.
export { TPEX_SHARE_PREVIEW_LIMIT } from './OrganizedTpexShareEvidence';
export { CVM_PREVIEW_LIMIT } from './OrganizedCvmEvidence';
export { CFTC_PREVIEW_LIMIT } from './OrganizedCftcEvidence';
export { DERIBIT_PREVIEW_LIMIT } from './OrganizedDeribitEvidence';
export { KRAKEN_TRADE_PREVIEW_LIMIT } from './OrganizedKrakenTradeEvidence';
export { POLYMARKET_PREVIEW_LIMIT } from './OrganizedPolymarketEvidence';
export { POLYMARKET_INTEREST_PREVIEW_LIMIT } from './OrganizedPolymarketInterestEvidence';

export type OrganizedEvidenceReport =
  | OrganizedReport
  | OrganizedAshareReport
  | OrganizedTpexShareReport
  | OrganizedCvmReport
  | OrganizedCftcReport
  | OrganizedDeribitReport
  | OrganizedKrakenTradeReport
  | OrganizedPolymarketReport
  | OrganizedPolymarketInterestReport;

type Props = {
  report: OrganizedEvidenceReport | null;
  onDownload?: React.MouseEventHandler<HTMLAnchorElement>;
};

/** Route an already permitted report; source views own their labels and columns. */
export default function OrganizedEvidence({ report, onDownload }: Props) {
  if (!report) return null;

  switch (report.source_id) {
    case 'japan-mof':
    case 'tpex-money':
      return (
        <OrganizedMonetaryEvidence report={report} onDownload={onDownload} />
      );
    case 'eastmoney-ashare':
      return (
        <OrganizedAshareReportEvidence
          report={report}
          onDownload={onDownload}
        />
      );
    case 'tpex-shares':
      return (
        <OrganizedTpexShareEvidence report={report} onDownload={onDownload} />
      );
    case 'cvm-fund-equity':
      return <OrganizedCvmEvidence report={report} onDownload={onDownload} />;
    case 'cftc':
      return <OrganizedCftcEvidence report={report} onDownload={onDownload} />;
    case 'deribit-options':
      return (
        <OrganizedDeribitEvidence report={report} onDownload={onDownload} />
      );
    case 'kraken-trades':
      return (
        <OrganizedKrakenTradeEvidence report={report} onDownload={onDownload} />
      );
    case 'polymarket-gamma':
      return (
        <OrganizedPolymarketEvidence report={report} onDownload={onDownload} />
      );
    case 'polymarket-open-interest':
      return (
        <OrganizedPolymarketInterestEvidence
          report={report}
          onDownload={onDownload}
        />
      );
    default: {
      // A new report source must add a typed view rather than fall through.
      const unhandled: never = report;
      return unhandled;
    }
  }
}
