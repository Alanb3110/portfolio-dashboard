import { forwardPortfolioXirr } from './analytics';
import { BENCHMARKS, comparePortfolioToBenchmark, type BenchmarkComparison } from './benchmark';
import { forwardBenchmarkRequestWindow, replayBenchmarkFromBaseline } from './benchmark-forward';
import type { CashFlow, PortfolioAnalysis } from './domain';
import type { HistorySnapshot } from './history';
import { fetchMarketProxyPrices } from './providers/market-proxy';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedEur(value: number | null): string {
  if (value == null) return 'N/A';
  if (Math.abs(value) < 0.005) return formatEur(0);
  return `${value > 0 ? '+' : '−'}${formatEur(Math.abs(value))}`;
}

function formatPercent(value: number | null): string {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function metric(label: string, value: string, subtext?: string): HTMLElement {
  const card = element('section', 'metric-card');
  card.append(element('p', 'metric-label', label), element('strong', 'metric-value', value));
  if (subtext) card.append(element('p', 'metric-subtext', subtext));
  return card;
}

function earliestBaseline(snapshots: HistorySnapshot[], currentDate: string): HistorySnapshot | null {
  return [...snapshots]
    .filter((snapshot) => snapshot.snapshotDate <= currentDate)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))[0] ?? null;
}

function benchmarkCard(comparison: BenchmarkComparison, periodDays: number): HTMLElement {
  const xirrText = periodDays >= 30
    ? `XIRR ${formatPercent(comparison.benchmarkXirr)}`
    : `XIRR masqué : période courte (${periodDays} j)`;
  const terminal = comparison.terminalValue == null ? 'N/A' : formatEur(comparison.terminalValue);
  const card = metric(`${comparison.benchmark.label} simulé`, terminal, xirrText);
  const detail = element(
    'p',
    'metric-subtext',
    comparison.terminalValueGapEur == null
      ? comparison.note
      : `Portefeuille vs benchmark : ${formatSignedEur(comparison.terminalValueGapEur)} (${formatPercent(comparison.terminalValueGapRatio)})`,
  );
  card.append(detail);
  return card;
}

export function renderForwardBenchmarkPanel(
  analysis: PortfolioAnalysis,
  historySnapshots: HistorySnapshot[],
  mainFlows: CashFlow[],
): HTMLElement {
  const section = element('section', 'panel');
  section.append(
    element('h2', undefined, 'Comparaison World / S&P 500'),
    element(
      'p',
      'muted-block',
      'Benchmark matched-flow forward : même valeur de départ que le portefeuille principal, puis mêmes flux ultérieurs aux mêmes dates. Les PDF, transactions, quantités et valeurs du portefeuille ne sont jamais envoyés au serveur de marché.',
    ),
  );

  const baseline = earliestBaseline(historySnapshots, analysis.snapshotDate);
  if (!baseline) {
    section.append(element('p', 'status', 'Enregistre un premier snapshot local pour initialiser le benchmark forward.'));
    return section;
  }

  const periodDays = daysBetween(baseline.snapshotDate, analysis.snapshotDate);
  if (periodDays === 0) {
    section.append(
      element(
        'p',
        'status',
        `Baseline initialisée au ${baseline.snapshotDate} à ${formatEur(baseline.mainValue)}. La comparaison de performance apparaîtra à partir d’un snapshot ultérieur.`,
      ),
    );
    return section;
  }

  const status = element('p', 'status', `Chargement des benchmarks depuis la baseline du ${baseline.snapshotDate}…`);
  const output = element('div');
  section.append(status, output);

  void (async () => {
    try {
      const window = forwardBenchmarkRequestWindow(baseline.snapshotDate, analysis.snapshotDate);
      const [worldPrices, sp500Prices] = await Promise.all([
        fetchMarketProxyPrices(BENCHMARKS['msci-world'], window.from, window.to),
        fetchMarketProxyPrices(BENCHMARKS.sp500, window.from, window.to),
      ]);

      const actualForwardXirr = forwardPortfolioXirr(
        baseline.snapshotDate,
        baseline.mainValue,
        mainFlows,
        analysis.snapshotDate,
        analysis.mainValue,
      );
      const worldReplay = replayBenchmarkFromBaseline(
        BENCHMARKS['msci-world'],
        baseline,
        mainFlows,
        analysis.snapshotDate,
        worldPrices,
      );
      const sp500Replay = replayBenchmarkFromBaseline(
        BENCHMARKS.sp500,
        baseline,
        mainFlows,
        analysis.snapshotDate,
        sp500Prices,
      );

      const world = comparePortfolioToBenchmark(
        analysis.mainValue,
        actualForwardXirr.selectedRoot,
        worldReplay,
      );
      const sp500 = comparePortfolioToBenchmark(
        analysis.mainValue,
        actualForwardXirr.selectedRoot,
        sp500Replay,
      );

      const grid = element('div', 'metrics');
      const portfolioSubtext = periodDays >= 30
        ? `XIRR aligné ${formatPercent(actualForwardXirr.selectedRoot)}`
        : `XIRR aligné masqué : période courte (${periodDays} j)`;
      grid.append(
        metric('Portefeuille principal', formatEur(analysis.mainValue), portfolioSubtext),
        benchmarkCard(world, periodDays),
        benchmarkCard(sp500, periodDays),
      );
      output.replaceChildren(grid);

      const statuses = [world.status, sp500.status];
      status.textContent = statuses.every((value) => value === 'PASS')
        ? `PASS · comparaison depuis le ${baseline.snapshotDate}`
        : `Comparaison disponible avec limitation : World ${world.status}, S&P 500 ${sp500.status}.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.replaceChildren();
      status.textContent = `Benchmark indisponible (analyse locale conservée) : ${message}`;
    }
  })();

  return section;
}
