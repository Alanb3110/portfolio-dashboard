import { aggregateCashFlows, solveXirr } from './analytics';
import type { CashFlow, XirrDiagnostics } from './domain';

export type BenchmarkId = 'msci-world' | 'sp500';

export interface BenchmarkDefinition {
  id: BenchmarkId;
  label: string;
  proxyName: string;
  isin: string;
  ticker: string;
  venue: 'XETR';
  currency: 'EUR';
}

export const BENCHMARKS: Record<BenchmarkId, BenchmarkDefinition> = {
  'msci-world': {
    id: 'msci-world',
    label: 'MSCI World',
    proxyName: 'iShares Core MSCI World UCITS ETF',
    isin: 'IE00B4L5Y983',
    ticker: 'EUNL',
    venue: 'XETR',
    currency: 'EUR',
  },
  sp500: {
    id: 'sp500',
    label: 'S&P 500',
    proxyName: 'iShares Core S&P 500 UCITS ETF',
    isin: 'IE00B5BMR087',
    ticker: 'SXR8',
    venue: 'XETR',
    currency: 'EUR',
  },
};

export const DEFAULT_BENCHMARK_HISTORY_START = '2023-01-01';

export interface BenchmarkPricePoint {
  date: string;
  adjustedClose: number;
}

export interface BenchmarkDataRequest {
  benchmark: BenchmarkDefinition;
  from: string;
  to: string;
}

export interface BenchmarkPriceProvider {
  readonly providerId: string;
  fetchAdjustedDaily(request: BenchmarkDataRequest): Promise<BenchmarkPricePoint[]>;
}

export interface BenchmarkReplayResult {
  benchmark: BenchmarkDefinition;
  status: 'PASS' | 'WARN' | 'N/A';
  terminalValue: number | null;
  terminalPriceDate: string | null;
  terminalPrice: number | null;
  units: number | null;
  xirr: XirrDiagnostics;
  missingFlowDates: string[];
  ignoredFuturePricePoints: number;
  note: string;
}

export interface BenchmarkComparison {
  benchmark: BenchmarkDefinition;
  status: BenchmarkReplayResult['status'];
  terminalValue: number | null;
  terminalValueGapEur: number | null;
  terminalValueGapRatio: number | null;
  benchmarkXirr: number | null;
  xirrGap: number | null;
  terminalPriceDate: string | null;
  note: string;
}

function isIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function naXirr(note: string): XirrDiagnostics {
  return {
    status: 'N/A',
    roots: [],
    selectedRoot: null,
    residual: null,
    note,
  };
}

export function benchmarkRequestWindow(
  flows: CashFlow[],
  snapshotDate: string,
): { from: string; to: string } {
  if (!isIsoDate(snapshotDate)) throw new Error('Invalid benchmark snapshot date.');
  const aggregated = aggregateCashFlows(flows);
  const earliestFlow = aggregated[0]?.date;
  if (earliestFlow && !isIsoDate(earliestFlow)) throw new Error('Invalid benchmark cash-flow date.');
  return {
    // Request a coarse fixed history window rather than leaking each transaction date to a provider.
    from: earliestFlow && earliestFlow < DEFAULT_BENCHMARK_HISTORY_START ? earliestFlow : DEFAULT_BENCHMARK_HISTORY_START,
    to: snapshotDate,
  };
}

function preparePriceSeries(
  prices: BenchmarkPricePoint[],
  snapshotDate: string,
): {
  byDate: Map<string, number>;
  terminal: BenchmarkPricePoint | null;
  ignoredFuture: number;
  error: string | null;
} {
  const byDate = new Map<string, number>();
  let ignoredFuture = 0;

  for (const point of prices) {
    if (!isIsoDate(point.date)) {
      return { byDate, terminal: null, ignoredFuture, error: `Invalid benchmark price date: ${point.date}.` };
    }
    if (!Number.isFinite(point.adjustedClose) || point.adjustedClose <= 0) {
      return { byDate, terminal: null, ignoredFuture, error: `Invalid adjusted close on ${point.date}.` };
    }
    if (point.date > snapshotDate) {
      ignoredFuture += 1;
      continue;
    }
    if (byDate.has(point.date)) {
      return { byDate, terminal: null, ignoredFuture, error: `Duplicate benchmark price date: ${point.date}.` };
    }
    byDate.set(point.date, point.adjustedClose);
  }

  const terminalDate = [...byDate.keys()].filter((date) => date <= snapshotDate).sort().at(-1) ?? null;
  const terminal = terminalDate == null ? null : { date: terminalDate, adjustedClose: byDate.get(terminalDate)! };
  return { byDate, terminal, ignoredFuture, error: null };
}

export function replayMatchedFlowBenchmark(
  benchmark: BenchmarkDefinition,
  flows: CashFlow[],
  snapshotDate: string,
  prices: BenchmarkPricePoint[],
): BenchmarkReplayResult {
  if (!isIsoDate(snapshotDate)) throw new Error('Invalid benchmark snapshot date.');
  const cashFlows = aggregateCashFlows(flows);
  const futureFlow = cashFlows.find((flow) => flow.date > snapshotDate);
  if (futureFlow) {
    const note = `Cash flow ${futureFlow.date} occurs after snapshot ${snapshotDate}.`;
    return {
      benchmark,
      status: 'N/A',
      terminalValue: null,
      terminalPriceDate: null,
      terminalPrice: null,
      units: null,
      xirr: naXirr(note),
      missingFlowDates: [],
      ignoredFuturePricePoints: 0,
      note,
    };
  }

  const prepared = preparePriceSeries(prices, snapshotDate);
  if (prepared.error) {
    return {
      benchmark,
      status: 'N/A',
      terminalValue: null,
      terminalPriceDate: null,
      terminalPrice: null,
      units: null,
      xirr: naXirr(prepared.error),
      missingFlowDates: [],
      ignoredFuturePricePoints: prepared.ignoredFuture,
      note: prepared.error,
    };
  }

  if (!prepared.terminal) {
    const note = `No benchmark price is available on or before snapshot ${snapshotDate}.`;
    return {
      benchmark,
      status: 'N/A',
      terminalValue: null,
      terminalPriceDate: null,
      terminalPrice: null,
      units: null,
      xirr: naXirr(note),
      missingFlowDates: [],
      ignoredFuturePricePoints: prepared.ignoredFuture,
      note,
    };
  }

  const missingFlowDates = cashFlows
    .filter((flow) => Math.abs(flow.amount) > 1e-12 && !prepared.byDate.has(flow.date))
    .map((flow) => flow.date);
  if (missingFlowDates.length > 0) {
    const note = `Missing exact-date benchmark prices for ${missingFlowDates.join(', ')}.`;
    return {
      benchmark,
      status: 'N/A',
      terminalValue: null,
      terminalPriceDate: prepared.terminal.date,
      terminalPrice: prepared.terminal.adjustedClose,
      units: null,
      xirr: naXirr(note),
      missingFlowDates,
      ignoredFuturePricePoints: prepared.ignoredFuture,
      note,
    };
  }

  let units = 0;
  for (const flow of cashFlows) {
    const price = prepared.byDate.get(flow.date);
    if (price == null) continue;
    units += -flow.amount / price;
    if (units < -1e-10) {
      const note = `Matched withdrawal on ${flow.date} exceeds the synthetic benchmark value; negative benchmark units are not allowed.`;
      return {
        benchmark,
        status: 'N/A',
        terminalValue: null,
        terminalPriceDate: prepared.terminal.date,
        terminalPrice: prepared.terminal.adjustedClose,
        units: null,
        xirr: naXirr(note),
        missingFlowDates: [],
        ignoredFuturePricePoints: prepared.ignoredFuture,
        note,
      };
    }
    if (Math.abs(units) < 1e-10) units = 0;
  }

  const terminalValue = units * prepared.terminal.adjustedClose;
  const xirr = solveXirr([...cashFlows, { date: snapshotDate, amount: terminalValue }]);
  const staleTerminal = prepared.terminal.date < snapshotDate;
  const status: BenchmarkReplayResult['status'] =
    prepared.ignoredFuture > 0 || staleTerminal || xirr.status === 'WARN' ? 'WARN' : xirr.status === 'PASS' ? 'PASS' : 'N/A';

  const notes: string[] = [];
  if (staleTerminal) {
    notes.push(`Terminal value uses the latest close on or before the snapshot: ${prepared.terminal.date}.`);
  }
  if (prepared.ignoredFuture > 0) {
    notes.push(`${prepared.ignoredFuture} future price point(s) were ignored to prevent look-ahead.`);
  }
  if (xirr.status !== 'PASS') notes.push(`Benchmark XIRR: ${xirr.note}`);
  if (notes.length === 0) notes.push('Exact matched-flow replay completed with an exact-date terminal close.');

  return {
    benchmark,
    status,
    terminalValue,
    terminalPriceDate: prepared.terminal.date,
    terminalPrice: prepared.terminal.adjustedClose,
    units,
    xirr,
    missingFlowDates: [],
    ignoredFuturePricePoints: prepared.ignoredFuture,
    note: notes.join(' '),
  };
}

export function comparePortfolioToBenchmark(
  actualMainValue: number,
  actualMainXirr: number | null,
  replay: BenchmarkReplayResult,
): BenchmarkComparison {
  if (!Number.isFinite(actualMainValue)) throw new Error('Invalid actual portfolio value.');
  if (replay.terminalValue == null) {
    return {
      benchmark: replay.benchmark,
      status: replay.status,
      terminalValue: null,
      terminalValueGapEur: null,
      terminalValueGapRatio: null,
      benchmarkXirr: null,
      xirrGap: null,
      terminalPriceDate: replay.terminalPriceDate,
      note: replay.note,
    };
  }

  const terminalValueGapEur = actualMainValue - replay.terminalValue;
  const terminalValueGapRatio = replay.terminalValue !== 0 ? actualMainValue / replay.terminalValue - 1 : null;
  const benchmarkXirr = replay.xirr.selectedRoot;
  return {
    benchmark: replay.benchmark,
    status: replay.status,
    terminalValue: replay.terminalValue,
    terminalValueGapEur,
    terminalValueGapRatio,
    benchmarkXirr,
    xirrGap: actualMainXirr != null && benchmarkXirr != null ? actualMainXirr - benchmarkXirr : null,
    terminalPriceDate: replay.terminalPriceDate,
    note: replay.note,
  };
}
