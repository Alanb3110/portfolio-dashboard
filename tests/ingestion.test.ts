import { describe, expect, it } from 'vitest';
import { parseNetWorthText } from '../src/net-worth';
import { auditLedger, normalizeLedger, parseTransactions } from '../src/trade-republic';

const csv = `datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code\n2025-01-02T10:00:00Z,2025-01-02,PEA,TRADING,BUY,FUND,World,TEST00000001,10,100,-1000,-1,,EUR,,,,"quoted, description",tx-1,,,,\n2025-06-01T10:00:00Z,2025-06-01,PEA,CASH,DIVIDEND,FUND,World,TEST00000001,,,,20,,0,EUR,,,,Dividend,tx-2,,,,\n`;

const pdfText = `TRADE REPUBLIC BANK GMBH\nCOMPTE-TITRES 0523092902\nÉTAT DU PATRIMOINE NET\nau 27.08.2026\nPORTEFEUILLE VALEUR EN EUR\nCompte-Titres 726,65\nNon Coté 55,83\nWallet Crypto 1673,16\nEspèces 941,57\nPlan d'Épargne en Actions 4935,32\nTOTAL 8332,53 EUR\nCOMPTE-TITRES\n1,596751 Pièces Physical Gold 155,95 249,01\nISIN: FR0013416716\n2,942254 Pièces Space Innovators USD (Acc) 70,05 206,10\nISIN: IE000YU9K6K2\n2,276891 Pièces Space Exploration Techs. Corp. 119,26 271,54\nISIN: US84615Q1031\nNOMBRE DE POSITIONS : 3\nNON COTÉ\n0,2525 Pièces Private Equity A 110,63 27,93\nISIN: LU3176111881\n0,2525 Pièces Private Equity B 110,49 27,90\nISIN: LU3170240538\nNOMBRE DE POSITIONS : 2\nPORTEFEUILLE CRYPTO\n2,044314 Pièces Solana 89,90 183,78\nSOL\n0,021958 Pièces Bitcoin 67828,76 1489,38\nBTC\nNOMBRE DE POSITIONS : 2\nESPÈCES\nPLAN D'ÉPARGNE EN ACTIONS\n563 Pièces Pea Monde MSCI World EUR (Acc) 6,16 3469,77\nISIN: FR001400U5Q4\n12 Pièces MSCI Emerging Asia PEA ESG Leaders EUR (Acc) 39,07 468,84\nISIN: FR0013412012\n15 Pièces PEA MSCI Europe EUR (Acc) 40,18 602,63\nISIN: FR0013412038\n11 Pièces PEA MSCI Emerging Markets ESG EUR (Acc) 35,83 394,08\nISIN: FR0013412020\nNOMBRE DE POSITIONS : 4\n`;

describe('Trade Republic CSV parser', () => {
  it('parses quoted CSV and preserves canonical cash-flow signs', () => {
    const transactions = parseTransactions(csv);
    const ledger = normalizeLedger(transactions);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.description).toBe('quoted, description');
    expect(ledger[0]?.economicCashflowEur).toBe(-1001);
    expect(ledger[0]?.mainPerformanceCashflowEur).toBe(-1001);
    expect(ledger[1]?.mainPerformanceCashflowEur).toBe(20);
  });

  it('audits identifiers and required market fields', () => {
    const audit = auditLedger(normalizeLedger(parseTransactions(csv)));
    expect(audit.duplicateTransactionIds).toBe(0);
    expect(audit.mainBuySellRows).toBe(1);
    expect(audit.mainRequiredMarketFieldsComplete).toBe(1);
  });
});

describe('Net Worth parser', () => {
  it('parses scope values and positions from synthetic layout text', () => {
    const snapshot = parseNetWorthText(pdfText);
    expect(snapshot.snapshotDate).toBe('2026-08-27');
    expect(snapshot.summary.compteTitres).toBeCloseTo(726.65, 2);
    expect(snapshot.summary.pea).toBeCloseTo(4935.32, 2);
    expect(snapshot.summary.total).toBeCloseTo(8332.53, 2);
    expect(snapshot.positions).toHaveLength(11);
    expect(snapshot.positions.find((position) => position.symbol === 'BTC')?.value).toBeCloseTo(1489.38, 2);
    expect(snapshot.warnings).toEqual([]);
  });

  it('ignores the brokerage account number printed before the net-worth table', () => {
    const snapshot = parseNetWorthText(pdfText);
    expect(snapshot.summary.compteTitres).toBe(726.65);
    expect(snapshot.summary.compteTitres).not.toBe(523092902);
  });

  it('fails closed when the summary buckets do not reconcile with TOTAL', () => {
    const corrupted = pdfText.replace('TOTAL 8332,53 EUR', 'TOTAL 9000,00 EUR');
    expect(() => parseNetWorthText(corrupted)).toThrow(/does not reconcile/i);
  });
});
