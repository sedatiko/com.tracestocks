import { EventName } from '@stoqey/ib';
import { getIB } from './connection';

const BALANCE_TAGS = [
  'NetLiquidation',
  'TotalCashValue',
  'GrossPositionValue',
  'AvailableFunds',
  'BuyingPower',
].join(',');

export interface AccountBalance {
  netLiquidation: number;
  totalCash: number;
  grossPositionValue: number;
  availableFunds: number;
  buyingPower: number;
  currency: string;
}

export function getAccountBalance(): Promise<AccountBalance> {
  return new Promise((resolve, reject) => {
    const ib = getIB();
    const reqId = 9000;
    const raw: Record<string, string> = {};
    let currency = 'USD';

    const onSummary = (id: number, _account: string, tag: string, value: string, cur: string) => {
      if (id !== reqId) return;
      raw[tag] = value;
      if (cur) currency = cur;
    };

    const onEnd = (id: number) => {
      if (id !== reqId) return;
      ib.off(EventName.accountSummary, onSummary);
      ib.off(EventName.accountSummaryEnd, onEnd);
      ib.cancelAccountSummary(reqId);

      resolve({
        netLiquidation:   parseFloat(raw['NetLiquidation']   ?? '0'),
        totalCash:        parseFloat(raw['TotalCashValue']    ?? '0'),
        grossPositionValue: parseFloat(raw['GrossPositionValue'] ?? '0'),
        availableFunds:   parseFloat(raw['AvailableFunds']   ?? '0'),
        buyingPower:      parseFloat(raw['BuyingPower']      ?? '0'),
        currency,
      });
    };

    const onError = (code: number, msg: string, id: number) => {
      if (id !== reqId) return;
      ib.off(EventName.accountSummary, onSummary);
      ib.off(EventName.accountSummaryEnd, onEnd);
      ib.off(EventName.error, onError);
      reject(new Error(`[${code}] ${msg}`));
    };

    ib.on(EventName.accountSummary, onSummary);
    ib.on(EventName.accountSummaryEnd, onEnd);
    ib.on(EventName.error, onError);
    ib.reqAccountSummary(reqId, 'All', BALANCE_TAGS);
  });
}

export function printAccountBalance(balance: AccountBalance): void {
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: balance.currency });

  console.log('\n--- Account Balance ---');
  console.log(`  Net Liquidation:    ${fmt(balance.netLiquidation)}`);
  console.log(`  Total Cash:         ${fmt(balance.totalCash)}`);
  console.log(`  Gross Positions:    ${fmt(balance.grossPositionValue)}`);
  console.log(`  Available Funds:    ${fmt(balance.availableFunds)}`);
  console.log(`  Buying Power:       ${fmt(balance.buyingPower)}`);
  console.log('-----------------------\n');
}
