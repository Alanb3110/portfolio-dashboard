import type {
  LedgerAudit,
  LedgerRow,
  Scope,
  TradeRepublicTransaction,
} from './domain';

const REQUIRED_COLUMNS = [
  'datetime',
  'date',
  'account_type',
  'category',
  'type',
  'asset_class',
  'name',
  'symbol',
  'shares',
  'price',
  'amount',
  'fee',
  'tax',
  'currency',
  'description',
  'transaction_id',
] as const;

const MAIN_ASSET_CLASSES = new Set(['FUND', 'STOCK']);

function parseNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function nullable(value: string | undefined): string | null {
  const v = value?.trim() ?? '';
  return v === '' ? null : v;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((value) => value !== ''));
}

export function parseTransactions(text: string): TradeRepublicTransaction[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) throw new Error('Transaction CSV is empty.');

  const index = new Map(header.map((name, i) => [name.trim(), i]));
  const missing = REQUIRED_COLUMNS.filter((column) => !index.has(column));
  if (missing.length > 0) {
    throw new Error(`Transaction CSV missing required columns: ${missing.join(', ')}`);
  }

  const get = (row: string[], column: string): string | undefined => {
    const i = index.get(column);
    return i == null ? undefined : row[i];
  };

  return rows.slice(1).map((row) => ({
    datetime: get(row, 'datetime')?.trim() ?? '',
    date: get(row, 'date')?.trim() ?? '',
    accountType: get(row, 'account_type')?.trim() ?? '',
    category: get(row, 'category')?.trim() ?? '',
    type: get(row, 'type')?.trim() ?? '',
    assetClass: nullable(get(row, 'asset_class')),
    name: nullable(get(row, 'name')),
    symbol: nullable(get(row, 'symbol')),
    shares: parseNumber(get(row, 'shares')),
    price: parseNumber(get(row, 'price')),
    amount: parseNumber(get(row, 'amount')),
    fee: parseNumber(get(row, 'fee')),
    tax: parseNumber(get(row, 'tax')),
    currency: nullable(get(row, 'currency')),
    description: nullable(get(row, 'description')),
    transactionId: get(row, 'transaction_id')?.trim() ?? '',
  }));
}

export function classifyScope(transaction: TradeRepublicTransaction): Scope {
  if (transaction.assetClass === 'CRYPTO') return 'crypto';
  if (transaction.assetClass === 'PRIVATE_FUND') return 'private';
  if (
    (transaction.accountType === 'DEFAULT' || transaction.accountType === 'PEA') &&
    transaction.assetClass != null &&
    MAIN_ASSET_CLASSES.has(transaction.assetClass)
  ) {
    return 'main';
  }
  return 'cash';
}

function quantityEffect(transaction: TradeRepublicTransaction): number {
  const quantityBearing =
    (transaction.category === 'TRADING' && ['BUY', 'SELL'].includes(transaction.type)) ||
    (transaction.category === 'DELIVERY' && ['MIGRATION', 'FREE_RECEIPT'].includes(transaction.type)) ||
    (transaction.category === 'CORPORATE_ACTION' && transaction.type === 'SPLIT');
  return quantityBearing ? transaction.shares ?? 0 : 0;
}

export function normalizeLedger(transactions: TradeRepublicTransaction[]): LedgerRow[] {
  return transactions.map((transaction) => {
    const scope = classifyScope(transaction);
    const economicCashflowEur =
      (transaction.amount ?? 0) + (transaction.fee ?? 0) + (transaction.tax ?? 0);

    const canonicalMain =
      (scope === 'main' && transaction.category === 'TRADING' && ['BUY', 'SELL'].includes(transaction.type)) ||
      (transaction.symbol != null &&
        transaction.type === 'IPO_SUBSCRIPTION' &&
        transaction.assetClass != null &&
        MAIN_ASSET_CLASSES.has(transaction.assetClass)) ||
      (scope === 'main' && transaction.type === 'DIVIDEND');

    return {
      ...transaction,
      scope,
      economicCashflowEur,
      quantityEffect: quantityEffect(transaction),
      mainPerformanceCashflowEur: canonicalMain ? economicCashflowEur : 0,
    };
  });
}

function parisBusinessDate(datetime: string): string | null {
  const instant = new Date(datetime);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!values.year || !values.month || !values.day) return null;
  return `${values.year}-${values.month}-${values.day}`;
}

export function auditLedger(rows: LedgerRow[]): LedgerAudit {
  if (rows.length === 0) throw new Error('No transaction rows were parsed.');

  const ids = rows.map((row) => row.transactionId);
  const uniqueIds = new Set(ids);
  let dateVsParisMismatches = 0;
  let mainRelevantDateVsParisMismatches = 0;

  for (const row of rows) {
    const parisDate = parisBusinessDate(row.datetime);
    if (parisDate && parisDate !== row.date) {
      dateVsParisMismatches += 1;
      if (row.scope === 'main') mainRelevantDateVsParisMismatches += 1;
    }
  }

  const mainTrades = rows.filter(
    (row) => row.scope === 'main' && row.category === 'TRADING' && ['BUY', 'SELL'].includes(row.type),
  );
  const complete = mainTrades.filter(
    (row) => row.symbol != null && row.shares != null && row.price != null,
  ).length;

  const unresolvedMissingTradeAmounts = mainTrades.filter((trade) => {
    if (trade.amount != null) return false;
    return !rows.some(
      (candidate) =>
        candidate.symbol === trade.symbol &&
        candidate.type === 'IPO_SUBSCRIPTION' &&
        candidate.date <= trade.date,
    );
  }).length;

  const dates = rows.map((row) => row.date).filter(Boolean).sort();

  return {
    rows: rows.length,
    uniqueTransactionIds: uniqueIds.size,
    duplicateTransactionIds: ids.length - uniqueIds.size,
    firstDate: dates[0] ?? '',
    lastDate: dates.at(-1) ?? '',
    dateVsParisMismatches,
    mainRelevantDateVsParisMismatches,
    mainBuySellRows: mainTrades.length,
    mainRequiredMarketFieldsComplete: complete,
    unresolvedMissingTradeAmounts,
  };
}
