import type { NetWorthSnapshot } from './domain';
import {
  computeContributionRebalancing,
  computeRebalancing,
  createTargetConfig,
  mainPositionId,
  mainPositions,
  validateTargetConfig,
  type RebalancingTargetConfig,
} from './rebalancing';
import { subscribeUiSnapshot } from './snapshot-bridge';

const STORAGE_KEY = 'portfolio-dashboard-v5:rebalancing-targets-v1';

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

function formatSignedEur(value: number): string {
  if (Math.abs(value) < 0.005) return formatEur(0);
  return `${value > 0 ? '+' : '−'}${formatEur(Math.abs(value))}`;
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSignedPoints(value: number): string {
  const points = value * 100;
  if (Math.abs(points) < 0.05) return '0,0 pp';
  return `${points > 0 ? '+' : '−'}${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(points))} pp`;
}

function storedConfig(): { config: RebalancingTargetConfig | null; error: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { config: null, error: null };
    return { config: validateTargetConfig(JSON.parse(raw)), error: null };
  } catch (error) {
    return {
      config: null,
      error: `Configuration locale illisible : ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function saveConfig(config: RebalancingTargetConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function eraseConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function insertPanel(results: HTMLElement, panel: HTMLElement): void {
  const allocation = results.querySelector<HTMLElement>('#allocation-panel');
  if (allocation) {
    allocation.after(panel);
    return;
  }
  const quality = [...results.children].find((child): child is HTMLElement => {
    if (!(child instanceof HTMLElement)) return false;
    return child.querySelector('h2')?.textContent?.trim() === 'Qualité des données';
  });
  if (quality) quality.before(panel);
  else results.append(panel);
}

function actionButton(label: string, primary = false): HTMLButtonElement {
  const button = element('button', primary ? 'secondary-button rebalance-action rebalance-action--primary' : 'secondary-button rebalance-action', label) as HTMLButtonElement;
  button.type = 'button';
  return button;
}

function renderIntro(panel: HTMLElement, onEdit: () => void, storageError: string | null): void {
  const body = element('div', 'rebalance-body');
  body.append(
    element(
      'p',
      'muted-block',
      'Aucune cible n’est appliquée par défaut. Définis toi-même les poids cibles du portefeuille principal pour afficher les dérives et guider les prochains apports.',
    ),
  );
  if (storageError) body.append(element('p', 'warnings rebalance-warning', storageError));
  const button = actionButton('Configurer mes cibles', true);
  button.addEventListener('click', onEdit);
  body.append(button);
  panel.append(body);
}

function renderEditor(
  panel: HTMLElement,
  snapshot: NetWorthSnapshot,
  existingConfig: RebalancingTargetConfig | null,
  onSaved: () => void,
  onCancel: () => void,
): void {
  const positions = mainPositions(snapshot);
  const total = snapshot.summary.compteTitres + snapshot.summary.pea;
  const existing = new Map(existingConfig?.targets.map((target) => [target.id, target.targetWeight]) ?? []);
  const body = element('div', 'rebalance-body');
  body.append(
    element(
      'p',
      'muted-block',
      'Renseigne une cible pour chaque ligne actuelle. La somme doit être de 100 %. Les cibles sont conservées uniquement dans ce navigateur.',
    ),
  );

  const form = element('div', 'rebalance-target-form');
  const inputs: HTMLInputElement[] = [];
  for (const position of positions) {
    const id = mainPositionId(position);
    const row = element('label', 'rebalance-target-row');
    const identity = element('div');
    const currentWeight = total > 0 ? position.value / total : 0;
    identity.append(
      element('strong', undefined, position.name),
      element('span', 'muted', `${position.pocket} · actuel ${formatPercent(currentWeight)}`),
    );
    const inputWrap = element('div', 'rebalance-target-input-wrap');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = '0.1';
    input.inputMode = 'decimal';
    input.dataset.targetId = id;
    const prior = existing.get(id);
    if (prior != null) input.value = (prior * 100).toFixed(1);
    input.placeholder = (currentWeight * 100).toFixed(1);
    input.setAttribute('aria-label', `Cible ${position.name} en pourcentage`);
    inputWrap.append(input, element('span', undefined, '%'));
    row.append(identity, inputWrap);
    form.append(row);
    inputs.push(input);
  }

  const sumStatus = element('p', 'rebalance-sum-status', 'Somme des cibles : 0,0 %');
  const errorStatus = element('p', 'status rebalance-form-error');
  errorStatus.hidden = true;
  const actions = element('div', 'rebalance-form-actions');
  const seed = actionButton('Partir de l’allocation actuelle');
  const save = actionButton('Enregistrer les cibles', true);
  const cancel = actionButton('Annuler');
  actions.append(seed, save, cancel);

  const values = (): Array<{ id: string; percent: number }> | null => {
    const parsed: Array<{ id: string; percent: number }> = [];
    for (const input of inputs) {
      const normalized = input.value.trim().replace(',', '.');
      if (normalized === '') return null;
      const percent = Number(normalized);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
      parsed.push({ id: input.dataset.targetId!, percent });
    }
    return parsed;
  };

  const updateSum = (): void => {
    const parsed = values();
    const sum = parsed?.reduce((totalPercent, item) => totalPercent + item.percent, 0) ?? 0;
    sumStatus.textContent = `Somme des cibles : ${new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(sum)} %`;
    const complete = parsed != null && Math.abs(sum - 100) <= 0.1;
    sumStatus.classList.toggle('rebalance-sum-status--pass', complete);
    save.disabled = !complete;
  };

  for (const input of inputs) input.addEventListener('input', updateSum);
  seed.addEventListener('click', () => {
    positions.forEach((position, index) => {
      const currentWeight = total > 0 ? position.value / total : 0;
      inputs[index]!.value = (currentWeight * 100).toFixed(3);
    });
    updateSum();
  });
  cancel.addEventListener('click', onCancel);
  save.addEventListener('click', () => {
    const parsed = values();
    if (!parsed) return;
    try {
      const config = createTargetConfig(
        parsed.map((item) => ({ id: item.id, targetWeight: item.percent / 100 })),
      );
      saveConfig(config);
      onSaved();
    } catch (error) {
      errorStatus.hidden = false;
      errorStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  body.append(form, sumStatus, errorStatus, actions);
  panel.append(body);
  updateSum();
}

function renderContributionPlanner(
  snapshot: NetWorthSnapshot,
  config: RebalancingTargetConfig,
): HTMLElement {
  const planner = element('section', 'rebalance-contribution');
  planner.append(
    element('h3', 'subheading rebalance-contribution-title', 'Orienter le prochain apport'),
    element(
      'p',
      'rebalance-caveat',
      'Saisis le montant à investir : le calcul privilégie uniquement les lignes sous-pondérées après apport et ne suppose aucune vente.',
    ),
  );

  const controls = element('div', 'rebalance-contribution-controls');
  const field = element('label', 'rebalance-contribution-field');
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '10';
  input.inputMode = 'decimal';
  input.placeholder = '1 000';
  input.setAttribute('aria-label', 'Montant du prochain apport en euros');
  field.append(input, element('span', undefined, '€'));
  controls.append(field);
  planner.append(controls);

  const output = element('div', 'rebalance-contribution-output');
  output.append(element('p', 'status', 'Saisis un montant pour obtenir une répartition buy-only.'));
  planner.append(output);

  const renderPlan = (): void => {
    output.replaceChildren();
    const normalized = input.value.trim().replace(',', '.').replace(/\s/g, '');
    if (normalized === '') {
      output.append(element('p', 'status', 'Saisis un montant pour obtenir une répartition buy-only.'));
      return;
    }
    const contribution = Number(normalized);
    if (!Number.isFinite(contribution) || contribution <= 0) {
      output.append(element('p', 'warnings rebalance-warning', 'Le montant doit être strictement positif.'));
      return;
    }

    const plan = computeContributionRebalancing(snapshot, config, contribution);
    if (plan.status !== 'PASS') {
      output.append(element('p', 'warnings rebalance-warning', plan.note));
      return;
    }

    const summary = element('div', 'rebalance-contribution-summary');
    const amountCard = element('div', 'rebalance-summary-card');
    amountCard.append(
      element('span', 'allocation-kpi-label', 'Apport simulé'),
      element('strong', 'allocation-kpi-value', formatEur(plan.contributionEur)),
      element('span', 'allocation-kpi-note', `Portefeuille projeté ${formatEur(plan.projectedMainValue)}`),
    );
    const driftCard = element('div', 'rebalance-summary-card');
    driftCard.append(
      element('span', 'allocation-kpi-label', 'Dérive max projetée'),
      element('strong', 'allocation-kpi-value', formatSignedPoints(plan.maxProjectedAbsDrift ?? 0).replace('+', '')),
      element(
        'span',
        'allocation-kpi-note',
        `Avant ${formatSignedPoints(plan.maxCurrentAbsDrift ?? 0).replace('+', '')}`,
      ),
    );
    summary.append(amountCard, driftCard);
    output.append(summary);

    const purchases = plan.rows.filter((row) => row.purchaseEur >= 0.005);
    const list = element('div', 'rebalance-purchase-list');
    for (const row of purchases) {
      const item = element('div', 'rebalance-purchase-row');
      const identity = element('div', 'rebalance-row-identity');
      identity.append(
        element('strong', undefined, row.name),
        element('span', 'muted', `${row.pocket} · cible ${formatPercent(row.targetWeight)}`),
        element('span', 'rebalance-current-target', `Projeté ${formatPercent(row.projectedWeight)} · dérive ${formatSignedPoints(row.projectedDriftWeight)}`),
      );
      const amount = element('div', 'rebalance-purchase-amount');
      amount.append(
        element('span', 'muted', 'Acheter'),
        element('strong', undefined, formatEur(row.purchaseEur)),
      );
      item.append(identity, amount);
      list.append(item);
    }
    output.append(list);
    output.append(
      element(
        'p',
        'rebalance-caveat',
        'Montants théoriques en euros. Parts entières, prix d’exécution, frais, fiscalité et contraintes de passage d’ordre ne sont pas modélisés.',
      ),
    );
  };

  input.addEventListener('input', renderPlan);
  return planner;
}

function renderResult(
  panel: HTMLElement,
  snapshot: NetWorthSnapshot,
  config: RebalancingTargetConfig,
  onEdit: () => void,
  onErase: () => void,
): void {
  const result = computeRebalancing(snapshot, config);
  const body = element('div', 'rebalance-body');

  if (result.status !== 'PASS') {
    body.append(element('p', 'warnings rebalance-warning', result.note));
    if (result.status === 'INCOMPATIBLE') {
      body.append(
        element(
          'p',
          'status',
          `${result.missingTargetIds.length} nouvelle(s) ligne(s) sans cible · ${result.staleTargetIds.length} ancienne(s) cible(s) absente(s).`,
        ),
      );
    }
    const actions = element('div', 'rebalance-form-actions');
    const edit = actionButton('Mettre à jour les cibles', true);
    const erase = actionButton('Effacer les cibles');
    edit.addEventListener('click', onEdit);
    erase.addEventListener('click', onErase);
    actions.append(edit, erase);
    body.append(actions);
    panel.append(body);
    return;
  }

  const summary = element('div', 'rebalance-summary');
  summary.append(
    element('div', 'rebalance-summary-card'),
    element('div', 'rebalance-summary-card'),
  );
  const summaryCards = [...summary.children] as HTMLElement[];
  summaryCards[0]!.append(
    element('span', 'allocation-kpi-label', 'Dérive max'),
    element('strong', 'allocation-kpi-value', formatSignedPoints(result.maxAbsDrift ?? 0).replace('+', '')),
    element('span', 'allocation-kpi-note', 'Écart absolu maximal vs cible'),
  );
  summaryCards[1]!.append(
    element('span', 'allocation-kpi-label', 'Réallocation interne'),
    element('strong', 'allocation-kpi-value', formatEur(result.internalReallocationEur ?? 0)),
    element('span', 'allocation-kpi-note', 'Montant théorique à déplacer sans apport'),
  );
  body.append(summary, renderContributionPlanner(snapshot, config));

  const list = element('div', 'rebalance-list');
  for (const row of result.rows) {
    const item = element('div', 'rebalance-row');
    const identity = element('div', 'rebalance-row-identity');
    identity.append(
      element('strong', undefined, row.name),
      element('span', 'muted', `${row.pocket} · ${row.symbol ?? 'sans symbole'}`),
      element('span', 'rebalance-current-target', `Actuel ${formatPercent(row.currentWeight)} · cible ${formatPercent(row.targetWeight)}`),
    );
    const drift = element('div', 'rebalance-row-drift');
    const driftText = element('strong', undefined, formatSignedPoints(row.driftWeight));
    driftText.classList.add(row.driftWeight > 0.0005 ? 'rebalance-over' : row.driftWeight < -0.0005 ? 'rebalance-under' : 'rebalance-on-target');
    drift.append(
      driftText,
      element('span', 'muted', `Écart cible ${formatSignedEur(row.valueGap)}`),
    );
    item.append(identity, drift);
    list.append(item);
  }
  body.append(list);

  body.append(
    element(
      'p',
      'rebalance-caveat',
      'La réallocation interne reste une lecture mécanique à valeur totale constante. Pour un nouvel apport, utilise en priorité le simulateur buy-only ci-dessus.',
    ),
  );

  const actions = element('div', 'rebalance-form-actions');
  const edit = actionButton('Modifier les cibles');
  const erase = actionButton('Effacer les cibles');
  edit.addEventListener('click', onEdit);
  erase.addEventListener('click', onErase);
  actions.append(edit, erase);
  body.append(actions);
  panel.append(body);
}

function setupRebalancingUi(): boolean {
  const results = document.querySelector<HTMLElement>('.results');
  if (!results) return false;
  if (results.dataset.rebalancingBound === 'true') return true;
  results.dataset.rebalancingBound = 'true';

  let snapshot: NetWorthSnapshot | null = null;
  let editing = false;
  let scheduled = false;
  let rendering = false;

  const render = (): void => {
    if (!snapshot || results.hidden) return;
    rendering = true;
    try {
      let panel = results.querySelector<HTMLElement>('#rebalancing-panel');
      if (!panel) {
        panel = element('section', 'panel rebalancing-panel');
        panel.id = 'rebalancing-panel';
        insertPanel(results, panel);
      }
      panel.replaceChildren(
        element('h2', undefined, 'Rebalancing'),
        element(
          'p',
          'muted-block',
          'Portefeuille principal uniquement. Les écarts sont calculés contre des cibles que tu définis explicitement sur cet appareil.',
        ),
      );

      const stored = storedConfig();
      const rerender = (): void => {
        editing = false;
        render();
      };
      const edit = (): void => {
        editing = true;
        render();
      };
      const erase = (): void => {
        if (!window.confirm('Effacer les cibles locales de rebalancing sur cet appareil ?')) return;
        try {
          eraseConfig();
          editing = false;
          render();
        } catch (error) {
          panel!.append(element('p', 'warnings rebalance-warning', error instanceof Error ? error.message : String(error)));
        }
      };

      if (editing) renderEditor(panel, snapshot, stored.config, rerender, rerender);
      else if (stored.config) renderResult(panel, snapshot, stored.config, edit, erase);
      else renderIntro(panel, edit, stored.error);
    } finally {
      rendering = false;
    }
  };

  const schedule = (): void => {
    if (scheduled || rendering) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      render();
    });
  };

  subscribeUiSnapshot((nextSnapshot) => {
    snapshot = nextSnapshot;
    editing = false;
    schedule();
  });

  schedule();
  return true;
}

if (!setupRebalancingUi()) {
  const observer = new MutationObserver(() => {
    if (!setupRebalancingUi()) return;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
