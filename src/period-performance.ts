import { aggregateCashFlows, forwardPortfolioXirr } from './analytics';
import type { CashFlow, XirrDiagnostics } from './domain';
import type { HistorySnapshot } from './history';

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

export interface StoredPeriodPerformance {
  status: 'PASS' | 'N/A';
  note: string;
  startDate: string;
  endDate: string;
  days: number;
  netContributionEur: number | null;
  rawValueDelta: number | null;
  economicPnl: number | null;
}

function dateMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function periodDays(startDate: string, endDate: string): number {
  return Math.round((dateMs(endDate) - dateMs(startDate)) / 86_400_000);
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
    days: periodDays(startDate, endDate),
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

export function computeStoredPeriodPerformance(
  previous: HistorySnapshot,
  current: HistorySnapshot,
): StoredPeriodPerformance {
  const days = periodDays(previous.snapshotDate, current.snapshotDate);
  const unavailable = (note: string): StoredPeriodPerformance => ({
    status: 'N/A',
    note,
    startDate: previous.snapshotDate,
    endDate: current.snapshotDate,
    days,
    netContributionEur: null,
    rawValueDelta: null,
    economicPnl: null,
  });

  if (days <= 0) return unavailable('Stored snapshot dates do not define a positive period.');
  if (previous.methodologyVersion !== '5.1' || current.methodologyVersion !== '5.1') {
    return unavailable('Period performance is not mixed across different or legacy financial methodologies.');
  }
  if (
    previous.ledgerFirstDate == null ||
    current.ledgerFirstDate == null ||
    previous.ledgerFirstDate !== current.ledgerFirstDate
  ) {
    return unavailable('Period performance requires the same known ledger start date on both snapshots.');
  }

  // simpleEconomicPnl(T) = V(T) + Σ CF(<=T), therefore the difference of two
  // compatible cumulative P&L observations is exactly the flow-adjusted P&L over the interval.
  const rawValueDelta = current.mainValue - previous.mainValue;
  const economicPnl = current.simpleEconomicPnl - previous.simpleEconomicPnl;
  const netContributionEur = rawValueDelta - economicPnl;

  return {
    status: 'PASS',
    note: 'Derived from two compatible saved snapshots using the frozen v5.1 cumulative economic P&L convention.',
    startDate: previous.snapshotDate,
    endDate: current.snapshotDate,
    days,
    netContributionEur,
    rawValueDelta,
    economicPnl,
  };
}
