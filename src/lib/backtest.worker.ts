import { backtest } from './backtest';
import type { Candle } from './types';

self.onmessage = (e: MessageEvent<{ id: number; candles: Candle[] }>) => {
  const out = backtest(e.data.candles);
  (self as unknown as Worker).postMessage({ id: e.data.id, result: out });
};
