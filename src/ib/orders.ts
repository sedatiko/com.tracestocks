import { EventName, OptionType, SecType, Contract, OrderAction, OrderType, TimeInForce, Order } from '@stoqey/ib';
import { getIB } from './connection';

const WARNING_CODES = new Set([10167, 2104, 2106, 2158, 2107, 2103]);

function nextValidOrderId(): Promise<number> {
  return new Promise((resolve, reject) => {
    const ib = getIB();
    const onId = (orderId: number) => {
      ib.off(EventName.nextValidId, onId);
      ib.off(EventName.error, onError);
      resolve(orderId);
    };
    const onError = (err: Error, code: number, id: number) => {
      if (id !== -1) return;
      ib.off(EventName.nextValidId, onId);
      ib.off(EventName.error, onError);
      reject(new Error(`[${code}] ${err.message}`));
    };
    ib.on(EventName.nextValidId, onId);
    ib.on(EventName.error, onError);
    ib.reqIds();
  });
}

export interface BuyOptionParams {
  symbol: string;
  expiration: string; // YYYYMMDD
  strike: number;
  right: 'C' | 'P';
  limitPrice: number;
  quantity?: number;
}

export interface OrderResult {
  orderId: number;
  status: string;
  filled: number;
  remaining: number;
  avgFillPrice: number;
}

export function buyOptionLimit(params: BuyOptionParams): Promise<OrderResult> {
  return new Promise(async (resolve, reject) => {
    const ib = getIB();
    const quantity = params.quantity ?? 1;

    let orderId: number;
    try {
      orderId = await nextValidOrderId();
    } catch (err) {
      reject(err);
      return;
    }

    const contract: Contract = {
      symbol: params.symbol,
      secType: SecType.OPT,
      exchange: 'SMART',
      currency: 'USD',
      lastTradeDateOrContractMonth: params.expiration,
      strike: params.strike,
      right: params.right === 'C' ? OptionType.Call : OptionType.Put,
      multiplier: 100,
    };

    const order: Order = {
      action: OrderAction.BUY,
      orderType: OrderType.LMT,
      totalQuantity: quantity,
      lmtPrice: params.limitPrice,
      tif: TimeInForce.DAY,
      transmit: true,
    };

    const cleanup = () => {
      ib.off(EventName.orderStatus, onStatus);
      ib.off(EventName.openOrder, onOpen);
      ib.off(EventName.error, onError);
    };

    let lastStatus = 'Submitted';
    let lastFilled = 0;
    let lastRemaining = quantity;
    let lastAvgFill = 0;
    let resolved = false;

    const finalize = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({
        orderId,
        status: lastStatus,
        filled: lastFilled,
        remaining: lastRemaining,
        avgFillPrice: lastAvgFill,
      });
    };

    const ACK_STATUSES = new Set(['Submitted', 'PreSubmitted', 'Filled', 'Cancelled', 'ApiCancelled', 'Inactive']);

    const onStatus = (
      id: number,
      status: string,
      filled: number,
      remaining: number,
      avgFillPrice: number,
    ) => {
      if (id !== orderId) return;
      lastStatus = status;
      lastFilled = filled;
      lastRemaining = remaining;
      lastAvgFill = avgFillPrice;
      console.log(`  orderStatus: ${status} filled=${filled} remaining=${remaining} avgFill=${avgFillPrice}`);
      if (ACK_STATUSES.has(status)) {
        // Brief grace period so any immediate fill update is captured before we exit.
        setTimeout(finalize, 750);
      }
    };

    const onOpen = (id: number, _c: Contract, _o: Order, state: { status?: string }) => {
      if (id !== orderId) return;
      if (state.status) {
        lastStatus = state.status;
        console.log(`  openOrder: status=${state.status}`);
      }
    };

    const onError = (err: Error, code: number, id: number) => {
      if (id !== orderId) return;
      if (WARNING_CODES.has(code)) return;
      cleanup();
      if (!resolved) {
        resolved = true;
        reject(new Error(`[${code}] ${err.message}`));
      }
    };

    ib.on(EventName.orderStatus, onStatus);
    ib.on(EventName.openOrder, onOpen);
    ib.on(EventName.error, onError);

    ib.placeOrder(orderId, contract, order);

    // Safety: hard-stop after 15s if no terminal status arrives.
    setTimeout(() => {
      if (!resolved) finalize();
    }, 15000);
  });
}
