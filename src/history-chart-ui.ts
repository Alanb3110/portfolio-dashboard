import { backfillBenchmarkObservations } from './history-benchmark-observations';
import { buildHistoryChartSeries, type HistoryChartPoint } from './history-chart';
import { loadHistorySnapshots } from './history';

const SVG_NS = 'http://www.w3.org/2000/svg';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatEur(value: number | null): string {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function dateMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function svgNode<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function seriesPath(
  points: HistoryChartPoint[],
  key: 'portfolio' | 'world' | 'sp500',
  x: (date: string) => number,
  y: (value: number) => number,
): string {
  let path = '';
  let active = false;
  for (const point of points) {
    const value = point[key];
    if (value == null) {
      active = false;
      continue;
    }
    path += `${active ? ' L' : ' M'} ${x(point.date).toFixed(2)} ${y(value).toFixed(2)}`;
    active = true;
  }
  return path;
}

function renderSvg(points: HistoryChartPoint[]): SVGSVGElement {
  const width = 720;
  const height = 280;
  const left = 62;
  const right = 16;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const values = points.flatMap((point) => [point.portfolio, point.world, point.sp500]).filter((value): value is number => value != null);
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  if (minValue === maxValue) {
    minValue *= 0.98;
    maxValue *= 1.02;
  }
  const padding = Math.max((maxValue - minValue) * 0.08, 1);
  minValue -= padding;
  maxValue += padding;

  const start = dateMs(points[0]!.date);
  const end = dateMs(points.at(-1)!.date);
  const duration = Math.max(end - start, 1);
  const x = (date: string) => left + ((dateMs(date) - start) / duration) * plotWidth;
  const y = (value: number) => top + (1 - (value - minValue) / (maxValue - minValue)) * plotHeight;

  const svg = svgNode('svg');
  svg.classList.add('history-chart-svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Évolution sparse du portefeuille principal et des benchmarks matched-flow');

  for (const fraction of [0, 0.5, 1]) {
    const value = maxValue - (maxValue - minValue) * fraction;
    const yy = top + plotHeight * fraction;
    const line = svgNode('line');
    line.setAttribute('x1', String(left));
    line.setAttribute('x2', String(width - right));
    line.setAttribute('y1', String(yy));
    line.setAttribute('y2', String(yy));
    line.classList.add('history-chart-gridline');
    svg.append(line);

    const label = svgNode('text');
    label.setAttribute('x', String(left - 8));
    label.setAttribute('y', String(yy + 4));
    label.setAttribute('text-anchor', 'end');
    label.classList.add('history-chart-axis-label');
    label.textContent = formatEur(value);
    svg.append(label);
  }

  const firstLabel = svgNode('text');
  firstLabel.setAttribute('x', String(left));
  firstLabel.setAttribute('y', String(height - 13));
  firstLabel.classList.add('history-chart-axis-label');
  firstLabel.textContent = points[0]!.date;
  svg.append(firstLabel);

  const lastLabel = svgNode('text');
  lastLabel.setAttribute('x', String(width - right));
  lastLabel.setAttribute('y', String(height - 13));
  lastLabel.setAttribute('text-anchor', 'end');
  lastLabel.classList.add('history-chart-axis-label');
  lastLabel.textContent = points.at(-1)!.date;
  svg.append(lastLabel);

  for (const [key, className] of [
    ['portfolio', 'history-series-portfolio'],
    ['world', 'history-series-world'],
    ['sp500', 'history-series-sp500'],
  ] as const) {
    const pathData = seriesPath(points, key, x, y);
    if (!pathData) continue;
    const path = svgNode('path');
    path.setAttribute('d', pathData);
    path.classList.add('history-series', className);
    svg.append(path);

    for (const point of points) {
      const value = point[key];
      if (value == null) continue;
      const circle = svgNode('circle');
      circle.setAttribute('cx', String(x(point.date)));
      circle.setAttribute('cy', String(y(value)));
      circle.setAttribute('r', key === 'portfolio' ? '4' : '3.3');
      circle.classList.add('history-point', className);
      const title = svgNode('title');
      title.textContent = `${point.date} · ${key === 'portfolio' ? 'Portefeuille' : key === 'world' ? 'MSCI World' : 'S&P 500'} · ${formatEur(value)}`;
      circle.append(title);
      svg.append(circle);
    }
  }

  return svg;
}

function renderLegend(latest: HistoryChartPoint): HTMLElement {
  const legend = element('div', 'history-chart-legend');
  const entries: Array<[string, string, number | null]> = [
    ['history-series-portfolio', 'Portefeuille', latest.portfolio],
    ['history-series-world', 'MSCI World', latest.world],
    ['history-series-sp500', 'S&P 500', latest.sp500],
  ];
  for (const [className, label, value] of entries) {
    const row = element('div', 'history-chart-legend-item');
    const dot = element('span', `history-chart-dot ${className}`);
    row.append(dot, element('span', undefined, label), element('strong', undefined, formatEur(value)));
    legend.append(row);
  }
  return legend;
}

function findBenchmarkPanel(results: HTMLElement): HTMLElement | null {
  return [...results.children].find((child): child is HTMLElement => {
    if (!(child instanceof HTMLElement)) return false;
    return child.querySelector('h2')?.textContent?.trim().startsWith('Comparaison World / S&P 500') ?? false;
  }) ?? null;
}

async function renderHistoryPanel(panel: HTMLElement): Promise<void> {
  await backfillBenchmarkObservations();
  const snapshots = await loadHistorySnapshots();
  const points = buildHistoryChartSeries(snapshots);
  panel.replaceChildren(element('h2', undefined, 'Évolution historique'));
  panel.append(
    element(
      'p',
      'muted-block',
      'Courbe sparse : uniquement les snapshots réellement enregistrés. Les benchmarks sont les valeurs synthétiques matched-flow, sans interpolation quotidienne.',
    ),
  );

  if (points.length < 2) {
    panel.append(element('p', 'status', 'Un second snapshot enregistré est nécessaire pour tracer une évolution.'));
    return;
  }

  panel.append(renderSvg(points), renderLegend(points.at(-1)!));

  const missingWorld = points.slice(1).some((point) => point.world == null);
  const missingSp500 = points.slice(1).some((point) => point.sp500 == null);
  if (missingWorld || missingSp500) {
    const missing = [missingWorld ? 'MSCI World' : null, missingSp500 ? 'S&P 500' : null].filter(Boolean).join(' / ');
    panel.append(element('p', 'status', `Historique benchmark partiel pour ${missing} : les points absents ne sont pas interpolés.`));
  }
}

function setupHistoryChart(): boolean {
  const results = document.querySelector<HTMLElement>('.results');
  const historyList = document.querySelector<HTMLElement>('.history-list');
  if (!results || !historyList) return false;
  if (results.dataset.historyChartBound === 'true') return true;
  results.dataset.historyChartBound = 'true';

  const panel = element('section', 'panel history-chart-panel');
  let scheduled = false;
  let rendering = false;
  let rerenderRequested = false;

  const schedule = (): void => {
    if (rendering) {
      rerenderRequested = true;
      return;
    }
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      rendering = true;
      if (!panel.isConnected) {
        const benchmark = findBenchmarkPanel(results);
        if (benchmark) benchmark.after(panel);
        else results.append(panel);
      }
      void renderHistoryPanel(panel)
        .catch((error) => {
          panel.replaceChildren(
            element('h2', undefined, 'Évolution historique'),
            element('p', 'status', `Historique indisponible : ${error instanceof Error ? error.message : String(error)}`),
          );
        })
        .finally(() => {
          rendering = false;
          if (rerenderRequested) {
            rerenderRequested = false;
            schedule();
          }
        });
    });
  };

  const resultsObserver = new MutationObserver((records) => {
    const externalMutation = records.some((record) => !panel.contains(record.target));
    if (externalMutation) schedule();
  });
  resultsObserver.observe(results, { childList: true, subtree: true, characterData: true });

  const historyObserver = new MutationObserver(() => schedule());
  historyObserver.observe(historyList, { childList: true, subtree: true });

  schedule();
  return true;
}

if (!setupHistoryChart()) {
  const observer = new MutationObserver(() => {
    if (!setupHistoryChart()) return;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
