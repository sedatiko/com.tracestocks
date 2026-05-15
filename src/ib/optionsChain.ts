import {
  EventName,
  OptionType,
  SecType,
  Contract,
} from '@stoqey/ib';
import { getIB } from './connection';
import { config } from '../config';
import type { OptionContract, OptionGreeks } from '../types';

const ACCEPTED_TICK_TYPES = { has: (_: number) => true };

const WARNING_CODES = new Set([10167]);

let nextReqId = 100;
function newReqId(): number {
  return nextReqId++;
}
function reserveReqIds(count: number): number {
  const start = nextReqId;
  nextReqId += count;
  return start;
}

export function getUnderlyingPrice(symbol: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ib = getIB();
    const reqId = newReqId();

    const contract: Contract = {
      symbol,
      secType: SecType.STK,
      exchange: 'SMART',
      currency: 'USD',
    };

    const onPrice = (id: number, tickType: number, price: number) => {
      if (id !== reqId) return;
      if (ACCEPTED_TICK_TYPES.has(tickType)) {
        ib.off(EventName.tickPrice, onPrice);
        ib.cancelMktData(reqId);
        resolve(price);
      }
    };

    const onError = (code: number, msg: string, id: number) => {
      if (id !== reqId) return;
      if (WARNING_CODES.has(code)) return;
      ib.off(EventName.error, onError);
      ib.off(EventName.tickPrice, onPrice);
      reject(new Error(`[${code}] ${msg}`));
    };

    ib.on(EventName.tickPrice, onPrice);
    ib.on(EventName.error, onError);
    ib.reqMktData(reqId, contract, '', true, false);
  });
}

const VOLUME_TICK_TYPES = new Set([8, 74]);
const OPT_COMP_TICK_TYPES = new Set([10, 11, 12, 13, 80, 81, 82, 83, 84]);
const PREFERRED_OPT_COMP = new Set([13, 84]);

function cleanGreek(v: unknown): number | undefined {
  if (typeof v !== 'number') return undefined;
  if (!Number.isFinite(v)) return undefined;
  if (v === Number.MAX_VALUE || v >= 1e100) return undefined;
  if (v <= -1) return undefined;
  return v;
}

export function getOptionsChain(
  symbol: string,
  underlyingPrice: number,
  expiration: string,
  right: 'C' | 'P',
): Promise<OptionContract[]> {
  return new Promise((resolve) => {
    const ib = getIB();

    const strikeStep = underlyingPrice < 50 ? 1 : underlyingPrice < 200 ? 5 : 10;
    const lower = Math.ceil(underlyingPrice * (1 - config.optionsChain.strikeRangePct) / strikeStep) * strikeStep;
    const upper = Math.floor(underlyingPrice * (1 + config.optionsChain.strikeRangePct) / strikeStep) * strikeStep;
    const strikes: number[] = [];
    for (let strike = lower; strike <= upper; strike += strikeStep) {
      strikes.push(strike);
    }

    if (strikes.length === 0) { resolve([]); return; }

    const reqId = reserveReqIds(strikes.length);

    const prices  = new Map<number, number>();
    const volumes = new Map<number, number>();
    const greeks  = new Map<number, OptionGreeks & { _source?: number }>();
    const done    = new Set<number>();
    let pending   = strikes.length;
    const ibAny   = ib as unknown as NodeJS.EventEmitter;

    const cleanup = () => {
      strikes.forEach((_, idx) => ib.cancelMktData(reqId + idx));
      ib.off(EventName.tickPrice,             onPrice);
      ibAny.off(EventName.tickSize,           onSize);
      ibAny.off(EventName.tickOptionComputation, onOptComp);
      ib.off(EventName.tickSnapshotEnd,       onSnapshotEnd);
      ib.off(EventName.error,                 onError);
    };

    const finish = (idx: number) => {
      if (done.has(idx)) return;
      done.add(idx);
      const price  = prices.get(idx);
      const strike = strikes[idx];
      if (price && price > 0 && strike !== undefined) {
        const entry: OptionContract = { symbol, strike, expiration, right, premium: price, underlyingPrice };
        const vol = volumes.get(idx);
        if (vol !== undefined) entry.volume = vol;
        const g = greeks.get(idx);
        if (g) {
          if (g.iv    !== undefined) entry.iv    = g.iv;
          if (g.delta !== undefined) entry.delta = g.delta;
          if (g.gamma !== undefined) entry.gamma = g.gamma;
          if (g.theta !== undefined) entry.theta = g.theta;
          if (g.vega  !== undefined) entry.vega  = g.vega;
        }
        results.push(entry);
      }
      pending--;
      if (pending === 0) { cleanup(); resolve(results); }
    };

    const results: OptionContract[] = [];

    const onPrice = (id: number, _tickType: number, price: number) => {
      const idx = id - reqId;
      if (idx < 0 || idx >= strikes.length) return;
      if (price > 0) prices.set(idx, price);
    };

    const onSize = (id: number, tickType: number, size: number) => {
      const idx = id - reqId;
      if (idx < 0 || idx >= strikes.length) return;
      if (VOLUME_TICK_TYPES.has(tickType)) volumes.set(idx, size);
    };

    const onOptComp = (...args: unknown[]) => {
      const id    = args[0] as number;
      const field = args[1] as number;
      const idx = id - reqId;
      if (idx < 0 || idx >= strikes.length) return;
      if (!OPT_COMP_TICK_TYPES.has(field)) return;

      const offset = (typeof args[2] === 'number' && typeof args[3] === 'number' && args.length >= 11) ? 3 : 2;

      const iv    = cleanGreek(args[offset + 0]);
      const delta = cleanGreek(args[offset + 1]);
      const gamma = cleanGreek(args[offset + 4]);
      const vega  = cleanGreek(args[offset + 5]);
      const theta = cleanGreek(args[offset + 6]);

      const existing = greeks.get(idx);
      if (existing?._source !== undefined && PREFERRED_OPT_COMP.has(existing._source) && !PREFERRED_OPT_COMP.has(field)) {
        return;
      }
      const next: OptionGreeks & { _source?: number } = { _source: field };
      if (iv    !== undefined) next.iv    = iv;
      if (delta !== undefined) next.delta = delta;
      if (gamma !== undefined) next.gamma = gamma;
      if (vega  !== undefined) next.vega  = vega;
      if (theta !== undefined) next.theta = theta;
      if (existing) {
        if (next.iv    === undefined && existing.iv    !== undefined) next.iv    = existing.iv;
        if (next.delta === undefined && existing.delta !== undefined) next.delta = existing.delta;
        if (next.gamma === undefined && existing.gamma !== undefined) next.gamma = existing.gamma;
        if (next.vega  === undefined && existing.vega  !== undefined) next.vega  = existing.vega;
        if (next.theta === undefined && existing.theta !== undefined) next.theta = existing.theta;
      }
      greeks.set(idx, next);
    };

    const onSnapshotEnd = (id: number) => {
      const idx = id - reqId;
      if (idx < 0 || idx >= strikes.length) return;
      finish(idx);
    };

    const onError = (code: number, msg: string, id: number) => {
      const idx = id - reqId;
      if (idx < 0 || idx >= strikes.length) return;
      if (WARNING_CODES.has(code)) return;
      finish(idx);
    };

    ib.on(EventName.tickPrice,             onPrice);
    ibAny.on(EventName.tickSize,           onSize);
    ibAny.on(EventName.tickOptionComputation, onOptComp);
    ib.on(EventName.tickSnapshotEnd,       onSnapshotEnd);
    ib.on(EventName.error,                 onError);

    strikes.forEach((strike, idx) => {
      const contract: Contract = {
        symbol,
        secType: SecType.OPT,
        exchange: 'SMART',
        currency: 'USD',
        lastTradeDateOrContractMonth: expiration,
        strike,
        right: right === 'C' ? OptionType.Call : OptionType.Put,
        multiplier: '100',
      };
      ib.reqMktData(reqId + idx, contract, '', true, false);
    });
  });
}

export function nearestExpiration(weeksOut = config.optionsChain.weeksOut): string {
  const d = new Date();
  d.setDate(d.getDate() + weeksOut * 7);
  const day = d.getDay();
  const daysToFriday = (5 - day + 7) % 7;
  d.setDate(d.getDate() + daysToFriday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

export function getExpirations(maxDte: number): string[] {
  const expirations: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(today);
  const daysToFriday = (5 - start.getDay() + 7) % 7 || 7;
  start.setDate(start.getDate() + daysToFriday);

  const cursor = new Date(start);
  while (true) {
    const dte = Math.round((cursor.getTime() - today.getTime()) / 86_400_000);
    if (dte > maxDte) break;
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    expirations.push(`${y}${m}${d}`);
    cursor.setDate(cursor.getDate() + 7);
  }

  return expirations;
}

export function calcDte(expiration: string): number {
  const y = parseInt(expiration.slice(0, 4), 10);
  const m = parseInt(expiration.slice(4, 6), 10) - 1;
  const d = parseInt(expiration.slice(6, 8), 10);
  const exp = new Date(y, m, d);
  exp.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - today.getTime()) / 86_400_000);
}
