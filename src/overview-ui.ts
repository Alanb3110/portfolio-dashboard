const METRIC_CLASSES = [
  'metric-card--primary',
  'metric-card--performance',
  'metric-card--secondary',
  'metric-positive',
  'metric-negative',
  'metric-neutral',
];

function parseDisplayedNumber(value: string): number | null {
  const normalized = value
    .replace(/[\s\u00a0\u202f€%]/g, '')
    .replace('−', '-')
    .replace(',', '.')
    .replace(/[^0-9+\-.]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function annotateMetric(card: HTMLElement): void {
  card.classList.remove(...METRIC_CLASSES);
  const label = card.querySelector<HTMLElement>('.metric-label')?.textContent?.trim() ?? '';
  const valueText = card.querySelector<HTMLElement>('.metric-value')?.textContent?.trim() ?? '';

  if (label === 'Portefeuille principal') {
    card.classList.add('metric-card--primary');
    return;
  }

  if (label === 'P&L économique' || label === 'XIRR principal') {
    card.classList.add('metric-card--performance');
    const value = parseDisplayedNumber(valueText);
    if (value == null || value === 0) card.classList.add('metric-neutral');
    else card.classList.add(value > 0 ? 'metric-positive' : 'metric-negative');
    return;
  }

  card.classList.add('metric-card--secondary');
}

function annotateResults(results: HTMLElement): void {
  for (const card of results.querySelectorAll<HTMLElement>('.metrics .metric-card')) annotateMetric(card);

  for (const panel of results.querySelectorAll<HTMLElement>(':scope > .panel')) {
    panel.classList.remove('benchmark-panel', 'positions-panel', 'quality-panel', 'history-comparison-panel');
    const heading = panel.querySelector<HTMLElement>('h2')?.textContent?.trim() ?? '';
    if (heading.startsWith('Comparaison World / S&P 500')) panel.classList.add('benchmark-panel');
    else if (heading === 'Positions principales') panel.classList.add('positions-panel');
    else if (heading === 'Qualité des données') panel.classList.add('quality-panel');
    else if (heading.startsWith('Depuis le snapshot du')) panel.classList.add('history-comparison-panel');
  }
}

function createDrawer(panel: HTMLElement, label: string): HTMLDetailsElement {
  const drawer = document.createElement('details');
  drawer.className = 'utility-drawer';
  const summary = document.createElement('summary');
  summary.textContent = label;
  drawer.append(summary, panel);
  return drawer;
}

function enhanceOverview(): boolean {
  const shell = document.querySelector<HTMLElement>('.shell');
  if (!shell) return false;
  if (shell.dataset.overviewEnhanced === 'true') return true;

  const directChildren = Array.from(shell.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
  const hero = directChildren.find((node) => node.classList.contains('hero'));
  const privacy = directChildren.find((node) => node.classList.contains('privacy'));
  const results = directChildren.find((node) => node.classList.contains('results'));
  const panels = directChildren.filter((node) => node.classList.contains('panel'));
  const importPanel = panels[0];
  const historyPanel = panels[1];

  if (!hero || !privacy || !results || !importPanel || !historyPanel) return false;

  const refreshButton = importPanel.querySelector<HTMLButtonElement>('.primary-button');
  const importStatus = importPanel.querySelector<HTMLElement>('.status');
  const saveSnapshotButton = historyPanel.querySelector<HTMLButtonElement>('.action-grid .secondary-button');
  if (!refreshButton || !importStatus || !saveSnapshotButton) return false;

  shell.dataset.overviewEnhanced = 'true';
  shell.classList.add('dashboard-shell');
  privacy.classList.add('privacy--compact');

  const eyebrow = hero.querySelector<HTMLElement>('.eyebrow');
  const title = hero.querySelector<HTMLElement>('h1');
  const lede = hero.querySelector<HTMLElement>('.lede');
  if (eyebrow) eyebrow.textContent = 'Portfolio Dashboard v5.1';
  if (title) title.textContent = 'Portefeuille';
  if (lede) lede.textContent = 'Vue principale : Compte-titres + PEA. Crypto, non coté et espèces restent séparés.';

  const quickActions = document.createElement('section');
  quickActions.className = 'quick-actions';
  quickActions.setAttribute('aria-label', 'Actualisation du portefeuille');

  const actionHeading = document.createElement('div');
  actionHeading.className = 'quick-actions-heading';
  const actionLabel = document.createElement('span');
  actionLabel.textContent = 'Sources locales';
  const actionHint = document.createElement('span');
  actionHint.textContent = 'Actualise puis lis le dashboard.';
  actionHeading.append(actionLabel, actionHint);

  const actionRow = document.createElement('div');
  actionRow.className = 'quick-actions-row';
  refreshButton.classList.add('quick-refresh-button');
  saveSnapshotButton.classList.add('quick-save-button');
  saveSnapshotButton.textContent = 'Enregistrer';
  saveSnapshotButton.title = 'Enregistrer le snapshot dérivé dans l’historique local';
  actionRow.append(refreshButton, saveSnapshotButton);
  importStatus.classList.add('quick-status');
  quickActions.append(actionHeading, actionRow, importStatus);

  const sourceDrawer = createDrawer(importPanel, 'Sources et import manuel');
  const historyDrawer = createDrawer(historyPanel, 'Historique local et sauvegardes');

  privacy.after(quickActions);
  quickActions.after(results);
  shell.append(sourceDrawer, historyDrawer);

  annotateResults(results);
  const resultsObserver = new MutationObserver(() => annotateResults(results));
  resultsObserver.observe(results, { childList: true, subtree: true });

  return true;
}

if (!enhanceOverview()) {
  const startupObserver = new MutationObserver(() => {
    if (!enhanceOverview()) return;
    startupObserver.disconnect();
  });
  startupObserver.observe(document.documentElement, { childList: true, subtree: true });
}
