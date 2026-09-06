import {
  buildAllocationViews,
  concentrationCoverageReliable,
  type AllocationView,
  type AllocationViewId,
} from './allocation';
import type { NetWorthSnapshot } from './domain';
import { subscribeUiSnapshot } from './snapshot-bridge';

const VIEW_ORDER: AllocationViewId[] = ['main', 'pea', 'ct', 'crypto'];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
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

function formatPercent(value: number | null): string {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatNumber(value: number | null, digits = 2): string {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function legacyPositionsPanel(results: HTMLElement): HTMLElement | null {
  return [...results.children].find((child): child is HTMLElement => {
    if (!(child instanceof HTMLElement)) return false;
    return child.querySelector('h2')?.textContent?.trim() === 'Positions principales';
  }) ?? null;
}

function concentrationMetric(label: string, value: string, explanation: string): HTMLElement {
  const card = element('div', 'allocation-kpi');
  card.append(
    element('span', 'allocation-kpi-label', label),
    element('strong', 'allocation-kpi-value', value),
    element('span', 'allocation-kpi-note', explanation),
  );
  return card;
}

function renderPositions(view: AllocationView): HTMLElement {
  const list = element('div', 'position-list allocation-position-list');
  if (view.positions.length === 0) {
    list.append(element('p', 'status', 'Aucune position extraite pour cette poche.'));
    return list;
  }

  for (const position of view.positions) {
    const row = element('div', 'position-row');
    const identity = element('div');
    identity.append(
      element('strong', undefined, position.name),
      element('span', 'muted', `${position.pocket} · ${position.symbol ?? 'sans symbole'}`),
    );
    const values = element('div', 'position-values');
    values.append(
      element('strong', undefined, formatEur(position.value)),
      element('span', 'muted', formatPercent(position.weight)),
    );
    row.append(identity, values);
    list.append(row);
  }
  return list;
}

function renderView(panel: HTMLElement, snapshot: NetWorthSnapshot, selected: AllocationViewId): void {
  const views = buildAllocationViews(snapshot);
  const view = views[selected];
  const reliable = concentrationCoverageReliable(view);

  const heading = element('div', 'allocation-view-heading');
  const identity = element('div');
  identity.append(
    element('span', 'allocation-view-label', view.label),
    element('strong', 'allocation-view-value', formatEur(view.officialValue)),
  );
  const count = element('span', 'allocation-position-count', `${view.positions.length} position${view.positions.length > 1 ? 's' : ''}`);
  heading.append(identity, count);

  const kpis = element('div', 'allocation-kpis');
  kpis.append(
    concentrationMetric('Top 1 ligne', reliable ? formatPercent(view.top1Weight) : 'N/A', 'Poids de la plus grosse ligne'),
    concentrationMetric('Top 3 lignes', reliable ? formatPercent(view.top3Weight) : 'N/A', 'Poids cumulé des 3 plus grosses lignes'),
    concentrationMetric('HHI lignes', reliable ? formatNumber(view.hhi, 3) : 'N/A', 'Somme des poids² par ligne ; plus bas = plus dispersé'),
    concentrationMetric('N lignes équiv.', reliable ? formatNumber(view.effectivePositionCount, 1) : 'N/A', '1 / HHI en lignes équipondérées'),
  );

  const content = panel.querySelector<HTMLElement>('.allocation-view-content');
  if (!content) return;
  content.replaceChildren(heading, kpis);

  if (selected === 'crypto') {
    content.append(
      element(
        'p',
        'allocation-scope-note',
        'Crypto analysé séparément : cette poche n’entre pas dans la comparaison principale MSCI World / S&P 500.',
      ),
    );
  }

  if (!reliable) {
    content.append(
      element(
        'p',
        'warnings allocation-coverage-warning',
        `Concentration masquée : les positions extraites couvrent ${formatPercent(view.coverageRatio)} de la valeur officielle de la poche.`,
      ),
    );
  }

  content.append(renderPositions(view));

  for (const button of panel.querySelectorAll<HTMLButtonElement>('.allocation-tab')) {
    const active = button.dataset.view === selected;
    button.classList.toggle('allocation-tab--active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  }
}

function createPanel(snapshot: NetWorthSnapshot, selected: AllocationViewId, onSelect: (view: AllocationViewId) => void): HTMLElement {
  const panel = element('section', 'panel allocation-panel');
  panel.id = 'allocation-panel';
  panel.dataset.snapshotDate = snapshot.snapshotDate;
  panel.append(
    element('h2', undefined, 'Allocation & concentration'),
    element(
      'p',
      'muted-block',
      'Concentration par ligne uniquement : un ETF compte comme une seule ligne. Top 1 / Top 3, HHI et N équivalent ne mesurent donc pas la diversification économique look-through de ses sous-jacents.',
    ),
  );

  const tabs = element('div', 'allocation-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Poche du portefeuille');
  const labels: Record<AllocationViewId, string> = {
    main: 'Principal',
    pea: 'PEA',
    ct: 'CT',
    crypto: 'Crypto',
  };
  for (const view of VIEW_ORDER) {
    const button = element('button', 'allocation-tab', labels[view]) as HTMLButtonElement;
    button.type = 'button';
    button.dataset.view = view;
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => onSelect(view));
    tabs.append(button);
  }
  panel.append(tabs, element('div', 'allocation-view-content'));
  renderView(panel, snapshot, selected);
  return panel;
}

function setupAllocationUi(): boolean {
  const results = document.querySelector<HTMLElement>('.results');
  if (!results) return false;
  if (results.dataset.allocationBound === 'true') return true;
  results.dataset.allocationBound = 'true';

  let snapshot: NetWorthSnapshot | null = null;
  let selectedView: AllocationViewId = 'main';
  let scheduled = false;

  const render = (): void => {
    if (results.hidden || !snapshot) return;
    const currentSnapshot = snapshot;
    const legacy = legacyPositionsPanel(results);
    if (legacy) legacy.hidden = true;

    const existing = results.querySelector<HTMLElement>('#allocation-panel');
    if (existing?.dataset.snapshotDate === currentSnapshot.snapshotDate) {
      renderView(existing, currentSnapshot, selectedView);
      return;
    }
    existing?.remove();

    const panel = createPanel(currentSnapshot, selectedView, (view) => {
      selectedView = view;
      const current = results.querySelector<HTMLElement>('#allocation-panel');
      if (current && snapshot) renderView(current, snapshot, selectedView);
    });

    if (legacy) legacy.before(panel);
    else results.append(panel);
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      render();
    });
  };

  subscribeUiSnapshot((nextSnapshot) => {
    snapshot = nextSnapshot;
    schedule();
  });

  const observer = new MutationObserver(() => schedule());
  observer.observe(results, { childList: true, subtree: true });
  schedule();
  return true;
}

if (!setupAllocationUi()) {
  const observer = new MutationObserver(() => {
    if (!setupAllocationUi()) return;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
