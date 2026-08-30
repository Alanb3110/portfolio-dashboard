import type {
  CashFlow,
  LedgerRow,
  NetWorthSnapshot,
  PortfolioAnalysis,
  XirrDiagnostics,
} from './domain';

// Frozen v4 convention: XIRR uses actual calendar-day differences divided by 365.
const XIRR_DAYS_PER_YEAR = 365;

function daysBetween(a: string, b: string): number {
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  return (end - start) / 86_400_000;
}

export function aggregateCashFlows(flows: CashFlow[]): CashFlow[] {
  const byDate = new Map<string, number>();
  for (const flow of flows) {
    byDate.set(flow.date, (byDate.get(flow.date) ?? 0) + flow.amount);
  }
  return [...byDate.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .filter((flow) => Math.abs(flow.amount) > 1e-12)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function xnpv(rate: number, flows: CashFlow[]): number {
  if (rate <= -1) return Number.NaN;
  const sorted = aggregateCashFlows(flows);
  const first = sorted[0];
  if (!first) return Number.NaN;

  return sorted.reduce((sum, flow) => {
    const years = daysBetween(first.date, flow.date) / XIRR_DAYS_PER_YEAR;
    return sum + flow.amount / Math.pow(1 + rate, years);
  }, 0);
}

function bisect(flows: CashFlow[], low: number, high: number): number | null {
  let fLow = xnpv(low, flows);
  let fHigh = xnpv(high, flows);
  if (!Number.isFinite(fLow) || !Number.isFinite(fHigh) || fLow * fHigh > 0) return null;

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (low + high) / 2;
    const fMid = xnpv(mid, flows);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) <= 1e-9 || Math.abs(high - low) <= 1e-12) return mid;

    if (fLow * fMid <= 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }

  return (low + high) / 2;
}

export function solveXirr(flows: CashFlow[]): XirrDiagnostics {
  const aggregated = aggregateCashFlows(flows);
  const hasNegative = aggregated.some((flow) => flow.amount < 0);
  const hasPositive = aggregated.some((flow) => flow.amount > 0);
  if (!hasNegative || !hasPositive) {
    return {
      status: 'N/A',
      roots: [],
      selectedRoot: null,
      residual: null,
      note: 'XIRR requires at least one negative and one positive cash flow.',
    };
  }

  const xs: number[] = [];
  const minLog = Math.log(1e-5);
  const maxLog = Math.log(1 + 1e6);
  const points = 800;
  for (let i = 0; i <= points; i += 1) {
    const x = minLog + ((maxLog - minLog) * i) / points;
    xs.push(Math.exp(x) - 1);
  }

  const roots: number[] = [];
  for (let i = 0; i < xs.length - 1; i += 1) {
    const low = xs[i];
    const high = xs[i + 1];
    if (low == null || high == null) continue;
    const fLow = xnpv(low, aggregated);
    const fHigh = xnpv(high, aggregated);
    if (!Number.isFinite(fLow) || !Number.isFinite(fHigh)) continue;

    if (Math.abs(fLow) <= 1e-9) roots.push(low);
    if (fLow * fHigh < 0) {
      const root = bisect(aggregated, low, high);
      if (root != null) roots.push(root);
    }
  }

  const uniqueRoots = roots
    .sort((a, b) => a - b)
    .filter((root, index, array) => index === 0 || Math.abs(root - (array[index - 1] ?? root)) > 1e-7);

  if (uniqueRoots.length === 0) {
    return {
      status: 'N/A',
      roots: [],
      selectedRoot: null,
      residual: null,
      note: 'No defensible XIRR root was found over the scanned rate domain.',
    };
  }

  if (uniqueRoots.length > 1) {
    return {
      status: 'WARN',
      roots: uniqueRoots,
      selectedRoot: null,
      residual: null,
      note: 'Multiple XIRR roots exist; no arbitrary root is selected.',
    };
  }

  const selectedRoot = uniqueRoots[0] ?? null;
  const residual = selectedRoot == null ? null : xnpv(selectedRoot, aggregated);
  return {
    status: 'PASS',
    roots: uniqueRoots,
    selectedRoot,
    residual,
    note: 'Unique converged XIRR root.',
  };
}

export function mainCashFlows(ledger: LedgerRow[]): CashFlow[] {
  return aggregateCashFlows(
    ledger
      .filter((row) => Math.abs(row.mainPerformanceCashflowEur) > 1e-12)
      .map((row) => ({ date: row.date, amount: row.mainPerformanceCashflowEur })),
  );
}

export function analyzePortfolio(
  ledger: LedgerRow[],
  snapshot: NetWorthSnapshot,
): PortfolioAnalysis {
  const mainValue = snapshot.summary.compteTitres + snapshot.summary.pea;
  const flows = mainCashFlows(ledger);
  const xirr = solveXirr([
    ...flows,
    { date: snapshot.snapshotDate, amount: mainValue },
  ]);
  const canonicalCashflowSum = flows.reduce((sum, flow) => sum + flow.amount, 0);

  const warnings = [...snapshot.warnings];
  if (xirr.status !== 'PASS') warnings.push(`Main XIRR status: ${xirr.status}. ${xirr.note}`);

  return {
    snapshotDate: snapshot.snapshotDate,
    mainValue,
    extendedInvestedValue: mainValue + snapshot.summary.crypto,
    totalNetWorth: snapshot.summary.total,
    simpleEconomicPnl: mainValue + canonicalCashflowSum,
    mainXirr: xirr,
    transactionCount: ledger.length,
    positionCount: snapshot.positions.length,
    warnings,
  };
}
