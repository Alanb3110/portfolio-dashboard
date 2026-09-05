import { aggregateCashFlows, solveXirr } from './analytics';
import type { CashFlow, XirrDiagnostics } from './domain';
import type {
  BenchmarkDefinition,
  BenchmarkId,
  BenchmarkPricePoint,
  BenchmarkReplayResult,
} from './benchmark';

export interface ForwardBenchmarkBaseline {
  snapshotDate: string;
  mainValue: number;
}

export const FORWARD_BENCHMARK_CHECKPOINT_METHOD = 'forward-matched-flow-v1' as const;

export interface ForwardBenchmarkCheckpoint {
  method: typeof FORWARD_BENCHMARK_CHECKPOINT_METHOD;
  benchmarkId: BenchmarkId;
  baselineDate: string;
  baselineMainValue: number;
  asOfDate: string;
  units: number;
  terminalValue: number;
  terminalPriceDate: string;
  terminalPrice: number;
}

function isIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function shiftUtcDays(date: string, days: number): string {
  if (!isIsoDate(date)) throw new Error('Invalid date.');
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function naXirr(note: string): XirrDiagnostics {
  return { status: 'N/A', roots: [], selectedRoot: null, residual: null, note };
}

export function forwardBenchmarkRequestWindow(
  baselineDate: string,
  snapshotDate: string,
): { from: string; to: string } {
  if (!isIsoDate(baselineDate) || !isIsoDate(snapshotDate) || baselineDate > snapshotDate) {
    throw new Error('Invalid forward benchmark date range.');
  }
  // Seven calendar days are enough to resolve a weekend/ordinary exchange-holiday baseline
  // without requesting any pre-v5 portfolio transaction history.
  return { from: shiftUtcDays(baselineDate, -7), to: snapshotDate };
}

export function checkpointBenchmarkRequestWindow(
  checkpointDate: string,
  snapshotDate: string,
): { from: string; to: string } {
  if (!isIsoDate(checkpointDate) || !isIsoDate(snapshotDate) || checkpointDate > snapshotDate) {
    throw new Error('Invalid benchmark checkpoint date range.');
  }
  // Checkpoint units already encode every matched flow through checkpointDate, so no older
  // benchmark price is required. Starting exactly at the checkpoint keeps requests bounded.
  return { from: checkpointDate, to: snapshotDate };
}

function invalidResult(
  benchmark: BenchmarkDefinition,
  note: string,
  ignoredFuturePricePoints = 0,
  missingFlowDates: string[] = [],
): BenchmarkReplayResult {
  return {
    benchmark,
    status: 'N/A',
    terminalValue: null,
    terminalPriceDate: null,
    terminalPrice: null,
    units: null,
    xirr: naXirr(note),
    missingFlowDates,
    ignoredFuturePricePoints,
    note,
  };
}

function preparePrices(
  benchmark: BenchmarkDefinition,
  snapshotDate: string,
  prices: BenchmarkPricePoint[],
): { byDate: Map<string, number>; priceDates: string[]; ignoredFuture: number; invalid: BenchmarkReplayResult | null } {
  const byDate = new Map<string, number>();
  let ignoredFuture = 0;
  for (const point of prices) {
    if (!isIsoDate(point.date)) {
      return {
        byDate,
        priceDates: [],
        ignoredFuture,
        invalid: invalidResult(benchmark, `Invalid benchmark price date: ${point.date}.`),
      };
    }
    if (!Number.isFinite(point.adjustedClose) || point.adjustedClose <= 0) {
      return {
        byDate,
        priceDates: [],
        ignoredFuture,
        invalid: invalidResult(benchmark, `Invalid adjusted close on ${point.date}.`),
      };
    }
    if (point.date > snapshotDate) {
      ignoredFuture += 1;
      continue;
    }
    if (byDate.has(point.date)) {
      return {
        byDate,
        priceDates: [],
        ignoredFuture,
        invalid: invalidResult(benchmark, `Duplicate benchmark price date: ${point.date}.`),
      };
    }
    byDate.set(point.date, point.adjustedClose);
  }
  return { byDate, priceDates: [...byDate.keys()].sort(), ignoredFuture, invalid: null };
}

function allForwardFlows(
  baseline: ForwardBenchmarkBaseline,
  allMainFlows: CashFlow[],
  snapshotDate: string,
): CashFlow[] {
  return aggregateCashFlows(allMainFlows).filter(
    (flow) => flow.date > baseline.snapshotDate && flow.date <= snapshotDate,
  );
}

function benchmarkXirr(
  baseline: ForwardBenchmarkBaseline,
  allMainFlows: CashFlow[],
  snapshotDate: string,
  terminalValue: number,
): XirrDiagnostics {
  if (baseline.snapshotDate === snapshotDate) {
    return naXirr('Benchmark baseline and terminal snapshot are the same date; no return period exists yet.');
  }
  return solveXirr([
    { date: baseline.snapshotDate, amount: -baseline.mainValue },
    ...allForwardFlows(baseline, allMainFlows, snapshotDate),
    { date: snapshotDate, amount: terminalValue },
  ]);
}

export function replayBenchmarkFromBaseline(
  benchmark: BenchmarkDefinition,
  baseline: ForwardBenchmarkBaseline,
  allMainFlows: CashFlow[],
  snapshotDate: string,
  prices: BenchmarkPricePoint[],
): BenchmarkReplayResult {
  if (
    !isIsoDate(baseline.snapshotDate) ||
    !isIsoDate(snapshotDate) ||
    baseline.snapshotDate > snapshotDate ||
    !Number.isFinite(baseline.mainValue) ||
    baseline.mainValue < 0
  ) {
    return invalidResult(benchmark, 'Invalid forward benchmark baseline or snapshot date.');
  }

  const prepared = preparePrices(benchmark, snapshotDate, prices);
  if (prepared.invalid) return prepared.invalid;
  const { byDate, priceDates, ignoredFuture } = prepared;

  const baselinePriceDate = priceDates.filter((date) => date <= baseline.snapshotDate).at(-1) ?? null;
  const terminalPriceDate = priceDates.filter((date) => date <= snapshotDate).at(-1) ?? null;
  if (!baselinePriceDate) return invalidResult(benchmark, `No benchmark close exists on or before baseline ${baseline.snapshotDate}.`, ignoredFuture);
  if (!terminalPriceDate) return invalidResult(benchmark, `No benchmark close exists on or before snapshot ${snapshotDate}.`, ignoredFuture);

  const futureFlows = allForwardFlows(baseline, allMainFlows, snapshotDate);
  const missingFlowDates = futureFlows
    .filter((flow) => Math.abs(flow.amount) > 1e-12 && !byDate.has(flow.date))
    .map((flow) => flow.date);
  if (missingFlowDates.length > 0) {
    return invalidResult(
      benchmark,
      `Missing exact-date benchmark prices for ${missingFlowDates.join(', ')}.`,
      ignoredFuture,
      missingFlowDates,
    );
  }

  const baselinePrice = byDate.get(baselinePriceDate)!;
  const terminalPrice = byDate.get(terminalPriceDate)!;
  let units = baseline.mainValue / baselinePrice;

  for (const flow of futureFlows) {
    const price = byDate.get(flow.date)!;
    units += -flow.amount / price;
    if (units < -1e-10) {
      return invalidResult(
        benchmark,
        `Matched withdrawal on ${flow.date} exceeds the synthetic benchmark value; negative benchmark units are not allowed.`,
        ignoredFuture,
      );
    }
    if (Math.abs(units) < 1e-10) units = 0;
  }

  const terminalValue = units * terminalPrice;
  const xirr = benchmarkXirr(baseline, allMainFlows, snapshotDate, terminalValue);

  const baselineUsesPriorClose = baselinePriceDate < baseline.snapshotDate;
  const terminalUsesPriorClose = terminalPriceDate < snapshotDate;
  const notes: string[] = [
    `Forward benchmark baseline: ${baseline.snapshotDate} at portfolio value ${baseline.mainValue.toFixed(2)} EUR.`,
  ];
  if (baselineUsesPriorClose) notes.push(`Baseline units use latest close on or before baseline: ${baselinePriceDate}.`);
  if (terminalUsesPriorClose) notes.push(`Terminal value uses latest close on or before snapshot: ${terminalPriceDate}.`);
  if (ignoredFuture > 0) notes.push(`${ignoredFuture} future price point(s) were ignored to prevent look-ahead.`);
  if (xirr.status !== 'PASS') notes.push(`Benchmark XIRR: ${xirr.note}`);

  let status: BenchmarkReplayResult['status'];
  if (baseline.snapshotDate === snapshotDate) {
    status = baselineUsesPriorClose || terminalUsesPriorClose || ignoredFuture > 0 ? 'WARN' : 'PASS';
  } else if (xirr.status === 'N/A') {
    status = 'N/A';
  } else {
    status = baselineUsesPriorClose || terminalUsesPriorClose || ignoredFuture > 0 || xirr.status === 'WARN' ? 'WARN' : 'PASS';
  }

  return {
    benchmark,
    status,
    terminalValue,
    terminalPriceDate,
    terminalPrice,
    units,
    xirr,
    missingFlowDates: [],
    ignoredFuturePricePoints: ignoredFuture,
    note: notes.join(' '),
  };
}

export function replayBenchmarkFromCheckpoint(
  benchmark: BenchmarkDefinition,
  baseline: ForwardBenchmarkBaseline,
  checkpoint: ForwardBenchmarkCheckpoint,
  allMainFlows: CashFlow[],
  snapshotDate: string,
  prices: BenchmarkPricePoint[],
): BenchmarkReplayResult {
  const compatible =
    checkpoint.method === FORWARD_BENCHMARK_CHECKPOINT_METHOD &&
    checkpoint.benchmarkId === benchmark.id &&
    checkpoint.baselineDate === baseline.snapshotDate &&
    Math.abs(checkpoint.baselineMainValue - baseline.mainValue) <= 0.005 &&
    isIsoDate(checkpoint.asOfDate) &&
    checkpoint.asOfDate >= baseline.snapshotDate &&
    checkpoint.asOfDate <= snapshotDate &&
    Number.isFinite(checkpoint.units) && checkpoint.units >= 0 &&
    Number.isFinite(checkpoint.terminalValue) && checkpoint.terminalValue >= 0 &&
    isIsoDate(checkpoint.terminalPriceDate) && checkpoint.terminalPriceDate <= checkpoint.asOfDate &&
    Number.isFinite(checkpoint.terminalPrice) && checkpoint.terminalPrice > 0;
  if (!compatible) {
    return invalidResult(benchmark, 'Benchmark checkpoint is incompatible with the current baseline or snapshot.');
  }

  if (checkpoint.asOfDate === snapshotDate) {
    const xirr = benchmarkXirr(baseline, allMainFlows, snapshotDate, checkpoint.terminalValue);
    return {
      benchmark,
      status: xirr.status === 'N/A' ? 'N/A' : xirr.status === 'WARN' ? 'WARN' : 'PASS',
      terminalValue: checkpoint.terminalValue,
      terminalPriceDate: checkpoint.terminalPriceDate,
      terminalPrice: checkpoint.terminalPrice,
      units: checkpoint.units,
      xirr,
      missingFlowDates: [],
      ignoredFuturePricePoints: 0,
      note: `Reused local benchmark checkpoint through ${checkpoint.asOfDate}.`,
    };
  }

  const prepared = preparePrices(benchmark, snapshotDate, prices);
  if (prepared.invalid) return prepared.invalid;
  const { byDate, priceDates, ignoredFuture } = prepared;
  const terminalPriceDate = priceDates.filter((date) => date <= snapshotDate).at(-1) ?? null;
  if (!terminalPriceDate) {
    return invalidResult(benchmark, `No benchmark close exists on or before snapshot ${snapshotDate}.`, ignoredFuture);
  }

  const newFlows = allForwardFlows(baseline, allMainFlows, snapshotDate).filter(
    (flow) => flow.date > checkpoint.asOfDate,
  );
  const missingFlowDates = newFlows
    .filter((flow) => Math.abs(flow.amount) > 1e-12 && !byDate.has(flow.date))
    .map((flow) => flow.date);
  if (missingFlowDates.length > 0) {
    return invalidResult(
      benchmark,
      `Missing exact-date benchmark prices for ${missingFlowDates.join(', ')}.`,
      ignoredFuture,
      missingFlowDates,
    );
  }

  let units = checkpoint.units;
  for (const flow of newFlows) {
    const price = byDate.get(flow.date)!;
    units += -flow.amount / price;
    if (units < -1e-10) {
      return invalidResult(
        benchmark,
        `Matched withdrawal on ${flow.date} exceeds the synthetic benchmark value; negative benchmark units are not allowed.`,
        ignoredFuture,
      );
    }
    if (Math.abs(units) < 1e-10) units = 0;
  }

  const terminalPrice = byDate.get(terminalPriceDate)!;
  const terminalValue = units * terminalPrice;
  const xirr = benchmarkXirr(baseline, allMainFlows, snapshotDate, terminalValue);
  const terminalUsesPriorClose = terminalPriceDate < snapshotDate;
  const notes = [`Advanced local benchmark checkpoint from ${checkpoint.asOfDate}.`];
  if (terminalUsesPriorClose) notes.push(`Terminal value uses latest close on or before snapshot: ${terminalPriceDate}.`);
  if (ignoredFuture > 0) notes.push(`${ignoredFuture} future price point(s) were ignored to prevent look-ahead.`);
  if (xirr.status !== 'PASS') notes.push(`Benchmark XIRR: ${xirr.note}`);

  const status: BenchmarkReplayResult['status'] =
    xirr.status === 'N/A'
      ? 'N/A'
      : terminalUsesPriorClose || ignoredFuture > 0 || xirr.status === 'WARN'
        ? 'WARN'
        : 'PASS';

  return {
    benchmark,
    status,
    terminalValue,
    terminalPriceDate,
    terminalPrice,
    units,
    xirr,
    missingFlowDates: [],
    ignoredFuturePricePoints: ignoredFuture,
    note: notes.join(' '),
  };
}

export function checkpointFromReplay(
  baseline: ForwardBenchmarkBaseline,
  snapshotDate: string,
  replay: BenchmarkReplayResult,
): ForwardBenchmarkCheckpoint | null {
  if (
    replay.status === 'N/A' ||
    replay.units == null ||
    replay.terminalValue == null ||
    replay.terminalPriceDate == null ||
    replay.terminalPrice == null
  ) {
    return null;
  }
  return {
    method: FORWARD_BENCHMARK_CHECKPOINT_METHOD,
    benchmarkId: replay.benchmark.id,
    baselineDate: baseline.snapshotDate,
    baselineMainValue: baseline.mainValue,
    asOfDate: snapshotDate,
    units: replay.units,
    terminalValue: replay.terminalValue,
    terminalPriceDate: replay.terminalPriceDate,
    terminalPrice: replay.terminalPrice,
  };
}
