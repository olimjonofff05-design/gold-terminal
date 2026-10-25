import { analyze } from './analysis';
import type { BacktestResult, Candle } from './types';

/**
 * Walk-forward test of the confluence engine on loaded history.
 * At each bar only past data is visible (no look-ahead). A trade is taken
 * at the bar close when a setup appears, then followed bar-by-bar until SL
 * or TP1 is hit (SL checked first — conservative), or 80 bars pass.
 */
export function backtest(c: Candle[], window = 300): BacktestResult & { equity: number[] } {
  const res: number[] = [];
  const equity: number[] = [0];
  let i = Math.min(150, c.length - 1);
  while (i < c.length - 2) {
    const slice = c.slice(Math.max(0, i - window + 1), i + 1);
    const a = analyze(slice, { light: true });
    const s = a?.setup;
    if (!s) {
      i++;
      continue;
    }
    const risk = Math.abs(s.entry - s.sl);
    let r: number | null = null;
    let j = i + 1;
    for (; j < c.length && j <= i + 80; j++) {
      const k = c[j];
      if (s.dir === 1) {
        if (k.low <= s.sl) { r = -1; break; }
        if (k.high >= s.tp1) { r = s.rr1; break; }
      } else {
        if (k.high >= s.sl) { r = -1; break; }
        if (k.low <= s.tp1) { r = s.rr1; break; }
      }
    }
    if (r === null) {
      if (j >= c.length) break; // still open at end of data — ignore
      r = ((c[Math.min(j, c.length - 1)].close - s.entry) * s.dir) / risk;
    }
    res.push(r);
    equity.push(equity[equity.length - 1] + r);
    i = j + 1;
  }
  const wins = res.filter((r) => r > 0);
  const losses = res.filter((r) => r <= 0);
  const gp = wins.reduce((s, r) => s + r, 0);
  const gl = -losses.reduce((s, r) => s + r, 0);
  let peak = 0;
  let maxDD = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    maxDD = Math.max(maxDD, peak - e);
  }
  const totalR = res.reduce((s, r) => s + r, 0);
  return {
    trades: res.length,
    wins: wins.length,
    winRate: res.length ? wins.length / res.length : 0,
    avgR: res.length ? totalR / res.length : 0,
    totalR,
    profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    maxDD,
    equity,
  };
}
