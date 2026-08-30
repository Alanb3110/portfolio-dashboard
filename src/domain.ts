export type Scope = 'main' | 'crypto' | 'private' | 'cash';
export type PositionPocket = 'Compte-titres' | 'PEA' | 'Crypto' | 'Non cote';

export interface TradeRepublicTransaction {
  datetime: string;
  date: string;
  accountType: string;
  category: string;
  type: string;
  assetClass: string | null;
  name: string | null;
  symbol: string | null;
  shares: number | null;
  price: number | null;
  amount: number | null;
  fee: number | null;
  tax: number | null;
  currency: string | null;
  description: string | null;
  transactionId: string;
}

export interface LedgerRow extends TradeRepublicTransaction {
  scope: Scope;
  economicCashflowEur: number;
  quantityEffect: number;
  mainPerformanceCashflowEur: number;
}

export interface LedgerAudit {
  rows: number;
  uniqueTransactionIds: number;
  duplicateTransactionIds: number;
  firstDate: string;
  lastDate: string;
  dateVsParisMismatches: number;
  mainRelevantDateVsParisMismatches: number;
  mainBuySellRows: number;
  mainRequiredMarketFieldsComplete: number;
  unresolvedMissingTradeAmounts: number;
}

export interface NetWorthSummary {
  compteTitres: number;
  pea: number;
  crypto: number;
  nonCote: number;
  cash: number;
  total: number;
}

export interface SnapshotPosition {
  pocket: PositionPocket;
  name: string;
  symbol: string | null;
  shares: number;
  price: number;
  value: number;
}

export interface NetWorthSnapshot {
  snapshotDate: string;
  generatedAt: string | null;
  summary: NetWorthSummary;
  positions: SnapshotPosition[];
  warnings: string[];
}

export interface CashFlow {
  date: string;
  amount: number;
}

export interface XirrDiagnostics {
  status: 'PASS' | 'WARN' | 'N/A';
  roots: number[];
  selectedRoot: number | null;
  residual: number | null;
  note: string;
}

export interface PortfolioAnalysis {
  snapshotDate: string;
  mainValue: number;
  extendedInvestedValue: number;
  totalNetWorth: number;
  simpleEconomicPnl: number;
  mainXirr: XirrDiagnostics;
  transactionCount: number;
  positionCount: number;
  warnings: string[];
}
