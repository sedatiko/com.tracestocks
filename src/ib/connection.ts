import { IBApi, EventName, ErrorCode } from '@stoqey/ib';
import { config } from '../config';


let ib: IBApi | null = null;

export function getIB(): IBApi {
  if (!ib) {
    ib = new IBApi({ 
      host: config.ib.host, 
      port: config.ib.port, 
      clientId: config.ib.clientId });
  }
  return ib;
}

export function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = getIB();

    const onError = (code: ErrorCode, msg: string, reqId: number) => {
      // reqId -1 means connection-level error
      if (reqId === -1) {
        client.off(EventName.error, onError);
        reject(new Error(`IB connection error [${code}]: ${msg}`));
      }
    };

    client.once(EventName.connected, () => {
      client.off(EventName.error, onError);
      // Switch to delayed market data (15 min) — avoids subscription errors on paper accounts
      client.reqMarketDataType(config.ib.marketDataType);
      console.log(`Connected to IB TWS on ${config.ib.host}:${config.ib.port} (market data type: ${config.ib.marketDataType})`);
      resolve();
    });

    client.on(EventName.error, onError);
    client.connect();
  });
}

export function disconnect(): void {
  ib?.disconnect();
  ib = null;
}
