import { aggregateCashFlows, forwardPortfolioXirr } from './analytics';
import type { CashFlow, XirrDiagnostics } from './domain';

export interface PeriodPerformance {
  startDate: string;
  endDate: string;
  days: number;
  startValue: number;
  endValue: number;
  canonicalCashflowSum: number;
  netContributionEur: number;
  rawValueDelta: number;
  economicPnl: number;
  xirr: XirrDiagnostics;
}

function dateMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function computePeriodPerformance(
  startDate: string,
  startValue: number,
  endDate: string,
  endValue: number,
  allMainFlows: CashFlow[],
): PeriodPerformance {
  const startMs = dateMs(startDate);
  const endMs = dateMs(endDate);
  if (
    Number.isNaN(startMs) ||
    Number.isNaN(endMs) ||
    endMs <= startMs ||
    !Number.isFinite(startValue) ||
    startValue < 0 ||
    !Number.isFinite(endValue) ||
    endValue < 0
  ) {
    throw new Error('Invalid snapshot period for performance comparison.');
  }

  const periodFlows = aggregateCashFlows(allMainFlows).filter(
    (flow) => flow.date > startDate && flow.date <= endDate,
  );
  const canonicalCashflowSum = periodFlows.reduce((sum, flow) => sum + flow.amount, 0);
  const rawValueDelta = endValue - startValue;

  return {
    startDate,
    endDate,
    days: Math.round((endMs - startMs) / 86_400_000),
    startValue,
    endValue,
    canonicalCashflowSum,
    // Frozen holdings-scope convention: BUY/contribution flows are negative.
    // Negating the canonical sum gives an intuitive positive amount for net money invested.
    netContributionEur: -canonicalCashflowSum,
    rawValueDelta,
    economicPnl: rawValueDelta + canonicalCashflowSum,
    xirr: forwardPortfolioXirr(startDate, startValue, periodFlows, endDate, endValue),
  };
}
