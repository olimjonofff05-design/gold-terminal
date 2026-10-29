import { atr as atrFn, ema, rsi as rsiFn } from './indicators';
import { nyParts } from './data';
import type {
  Analysis,
  Candle,
  Dir,
  Factor,
  FibInfo,
  KillzoneSpan,
  LiquidityLevel,
  Pivot,
  Setup,
  StructureEvent,
  Zone,
} from './types';

export const FIB_LEVELS: { r: number; label: string }[] = [
  { r: 0, label: '0' },
  { r: 0.236, label: '0.236' },
  { r: 0.382, label: '0.382' },
  { r: 0.5, label: '0.5 EQ' },
  { r: 0.618, label: '0.618' },
  { r: 0.705, label: '0.705 OTE' },
  { r: 0.786, label: '0.786' },
  { r: 1, label: '1' },
  { r: -0.272, label: '1.272' },
  { r: -0.618, label: '1.618' },
];

const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));

export function findPivots(c: Candle[], left = 3, right = 3): Pivot[] {
  const out: Pivot[] = [];
  for (let i = left; i < c.length - right; i++) {
    let isH = true;
    let isL = true;
    for (let k = i - left; k <= i + right; k++) {
      if (k === i) continue;
      if (c[k].high >= c[i].high) isH = false;
      if (c[k].low <= c[i].low) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) out.push({ i, time: c[i].time, price: c[i].high, type: 'H' });
    if (isL) out.push({ i, time: c[i].time, price: c[i].low, type: 'L' });
  }
  return out;
}

/**
 * ICT killzonalar Nyu-York vaqtida belgilanadi (yoz/qish vaqti avtomatik):
 * Asia 20:00–00:00, London 02:00–05:00, New York AM 07:00–10:00, London Close 10:00–12:00.
 */
export function kzOfNyHour(h: number): KillzoneSpan['kind'] | 'lclose' | null {
  if (h >= 20) return 'asia';
  if (h >= 2 && h < 5) return 'london';
  if (h >= 7 && h < 10) return 'ny';
  if (h >= 10 && h < 12) return 'lclose';
  return null;
}

function sessionOf(t: number): { name: string; killzone: boolean } {
  const h = nyParts(t).hour;
  const k = kzOfNyHour(h);
  if (k === 'london') return { name: 'London Killzone', killzone: true };
  if (k === 'ny') return { name: 'New York Killzone', killzone: true };
  if (k === 'lclose') return { name: 'London Close', killzone: true };
  if (k === 'asia') return { name: 'Osiyo sessiyasi', killzone: false };
  return { name: 'Sessiyalar oraligʻi', killzone: false };
}

/** Grafikda soyalash uchun killzone oraliqlari (faqat intraday TF) */
export function killzoneSpans(c: Candle[], stepSec: number): KillzoneSpan[] {
  if (!c.length || stepSec > 3600) return [];
  const off = nyParts(c[c.length - 1].time).offset;
  const out: KillzoneSpan[] = [];
  let cur: KillzoneSpan | null = null;
  for (const x of c) {
    const h = new Date((x.time + off) * 1000).getUTCHours();
    const k = kzOfNyHour(h);
    const kind = k === 'lclose' ? null : k;
    if (kind && cur && cur.kind === kind && x.time - cur.to <= stepSec) cur.to = x.time;
    else if (kind) out.push((cur = { from: x.time, to: x.time, kind }));
    else cur = null;
  }
  return out;
}

/** NY 00:00 ochilish narxi va undan oldingi Osiyo diapazoni */
function nyDayLevels(c: Candle[]): { nyOpen: number | null; asia: { high: number; low: number } | null } {
  const n = c.length;
  if (!n) return { nyOpen: null, asia: null };
  const step = n > 1 ? c[n - 1].time - c[n - 2].time : 0;
  if (!step || step > 3600) return { nyOpen: null, asia: null };
  const off = nyParts(c[n - 1].time).offset;
  const local = (t: number) => t + off;
  const dayStart = Math.floor(local(c[n - 1].time) / 86400) * 86400; // NY 00:00 (local seconds)
  let nyOpen: number | null = null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = n - 1; i >= 0; i--) {
    const lt = local(c[i].time);
    if (lt >= dayStart) {
      if (lt < dayStart + step) nyOpen = c[i].open;
      continue;
    }
    if (lt < dayStart - 4 * 3600) break;
    hi = Math.max(hi, c[i].high);
    lo = Math.min(lo, c[i].low);
  }
  if (nyOpen === null) {
    const first = c.find((x) => local(x.time) >= dayStart);
    nyOpen = first ? first.open : null;
  }
  return { nyOpen, asia: isFinite(hi) ? { high: hi, low: lo } : null };
}

export interface AnalyzeOptions {
  htfBias?: 0 | Dir;
  right?: number;
  light?: boolean; // skip arrays not needed for backtest
}

export function analyze(c: Candle[], opts: AnalyzeOptions = {}): Analysis | null {
  const n = c.length;
  if (n < 60) return null;
  const right = opts.right ?? 3;
  const closes = c.map((x) => x.close);
  const atrArr = atrFn(c, 14);
  const rsiArr = rsiFn(closes, 14);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const price = closes[n - 1];
  const atr = atrArr[n - 1];

  // ---------- Market structure (BOS / CHoCH) + Order Blocks ----------
  const pivots = findPivots(c, 3, right);
  const byConfirm = new Map<number, Pivot[]>();
  for (const p of pivots) {
    const k = p.i + right;
    if (!byConfirm.has(k)) byConfirm.set(k, []);
    byConfirm.get(k)!.push(p);
  }
  let trend: 0 | Dir = 0;
  let lastH: Pivot | null = null;
  let lastL: Pivot | null = null;
  const events: StructureEvent[] = [];
  const obs: (Zone & { dead?: boolean })[] = [];
  for (let j = 0; j < n; j++) {
    const conf = byConfirm.get(j);
    if (conf) for (const p of conf) { if (p.type === 'H') lastH = p; else lastL = p; }
    const cj = c[j];
    // order block invalidation
    for (const ob of obs) {
      if (ob.dead || ob.i >= j) continue;
      if (ob.dir === 1 && cj.close < ob.bottom) ob.dead = true;
      if (ob.dir === -1 && cj.close > ob.top) ob.dead = true;
    }
    if (lastH && !lastH.broken && cj.close > lastH.price) {
      lastH.broken = true;
      events.push({ i: j, time: cj.time, price: lastH.price, kind: trend === -1 ? 'CHoCH' : 'BOS', dir: 1, fromTime: lastH.time });
      trend = 1;
      // bullish OB: last bearish candle before the lowest point of the impulse
      let lo = lastH.i;
      for (let k = lastH.i; k <= j; k++) if (c[k].low < c[lo].low) lo = k;
      for (let k = lo; k >= Math.max(0, lo - 6); k--) {
        if (c[k].close < c[k].open) {
          obs.push({ kind: 'OB', dir: 1, top: c[k].high, bottom: c[k].low, time: c[k].time, i: k });
          break;
        }
      }
    }
    if (lastL && !lastL.broken && cj.close < lastL.price) {
      lastL.broken = true;
      events.push({ i: j, time: cj.time, price: lastL.price, kind: trend === 1 ? 'CHoCH' : 'BOS', dir: -1, fromTime: lastL.time });
      trend = -1;
      let hi = lastL.i;
      for (let k = lastL.i; k <= j; k++) if (c[k].high > c[hi].high) hi = k;
      for (let k = hi; k >= Math.max(0, hi - 6); k--) {
        if (c[k].close > c[k].open) {
          obs.push({ kind: 'OB', dir: -1, top: c[k].high, bottom: c[k].low, time: c[k].time, i: k });
          break;
        }
      }
    }
  }

  // ---------- Fair Value Gaps ----------
  const fvgs: (Zone & { dead?: boolean })[] = [];
  const startF = opts.light ? Math.max(2, n - 120) : 2;
  for (let i = startF; i < n; i++) {
    const a = c[i - 2];
    const b = c[i];
    const minGap = (atrArr[i] || 0) * 0.1;
    if (b.low - a.high > minGap) fvgs.push({ kind: 'FVG', dir: 1, top: b.low, bottom: a.high, time: c[i - 1].time, i: i - 1 });
    if (a.low - b.high > minGap) fvgs.push({ kind: 'FVG', dir: -1, top: a.low, bottom: b.high, time: c[i - 1].time, i: i - 1 });
  }
  for (const z of fvgs) {
    for (let k = z.i + 2; k < n; k++) {
      if (z.dir === 1) {
        if (c[k].low <= z.bottom) { z.dead = true; break; }
        z.top = Math.min(z.top, c[k].low);
      } else {
        if (c[k].high >= z.top) { z.dead = true; break; }
        z.bottom = Math.max(z.bottom, c[k].high);
      }
    }
  }
  const live = (arr: (Zone & { dead?: boolean })[], dir: Dir, k: number) =>
    arr.filter((z) => !z.dead && z.dir === dir && z.top > z.bottom).slice(-k);
  const zones: Zone[] = [...live(fvgs, 1, 4), ...live(fvgs, -1, 4), ...live(obs, 1, 3), ...live(obs, -1, 3)];

  // ---------- Liquidity ----------
  const confirmed = pivots.filter((p) => p.i + right < n);
  const liquidity: LiquidityLevel[] = [];
  const highs = confirmed.filter((p) => p.type === 'H');
  const lows = confirmed.filter((p) => p.type === 'L');
  const unbrokenHighs = highs.filter((p) => !c.slice(p.i + 1).some((x) => x.high > p.price)).slice(-3);
  const unbrokenLows = lows.filter((p) => !c.slice(p.i + 1).some((x) => x.low < p.price)).slice(-3);
  for (const p of unbrokenHighs) liquidity.push({ kind: 'BSL', price: p.price, time: p.time });
  for (const p of unbrokenLows) liquidity.push({ kind: 'SSL', price: p.price, time: p.time });
  const tol = atr * 0.15;
  const rh = highs.slice(-8);
  for (let a = 0; a < rh.length; a++)
    for (let b = a + 1; b < rh.length; b++)
      if (Math.abs(rh[a].price - rh[b].price) < tol && price < Math.max(rh[a].price, rh[b].price))
        liquidity.push({ kind: 'EQH', price: Math.max(rh[a].price, rh[b].price), time: rh[a].time });
  const rl = lows.slice(-8);
  for (let a = 0; a < rl.length; a++)
    for (let b = a + 1; b < rl.length; b++)
      if (Math.abs(rl[a].price - rl[b].price) < tol && price > Math.min(rl[a].price, rl[b].price))
        liquidity.push({ kind: 'EQL', price: Math.min(rl[a].price, rl[b].price), time: rl[a].time });
  // previous day high / low
  const lastDay = Math.floor(c[n - 1].time / 86400);
  let pdh = -Infinity;
  let pdl = Infinity;
  let pdt = 0;
  for (let i = n - 1; i >= 0; i--) {
    const d = Math.floor(c[i].time / 86400);
    if (d === lastDay - 1) {
      pdh = Math.max(pdh, c[i].high);
      pdl = Math.min(pdl, c[i].low);
      pdt = c[i].time;
    } else if (d < lastDay - 1) break;
  }
  if (isFinite(pdh)) {
    liquidity.push({ kind: 'PDH', price: pdh, time: pdt });
    liquidity.push({ kind: 'PDL', price: pdl, time: pdt });
  }

  const day = nyDayLevels(c); // backtest ham xuddi shu qoidalar bilan ishlashi uchun light'da ham hisoblanadi
  if (day.asia) {
    if (price < day.asia.high) liquidity.push({ kind: 'AsH', price: day.asia.high, time: c[n - 1].time });
    if (price > day.asia.low) liquidity.push({ kind: 'AsL', price: day.asia.low, time: c[n - 1].time });
  }

  {
    const seen = new Set<string>();
    for (let i = liquidity.length - 1; i >= 0; i--) {
      const k = liquidity[i].kind.slice(-1) + Math.round(liquidity[i].price / (atr * 0.05));
      if (seen.has(k)) liquidity.splice(i, 1);
      else seen.add(k);
    }
  }

  // ---------- Liquidity sweep (stop hunt) in last 6 bars ----------
  let sweep: Analysis['sweep'] = null;
  for (let j = n - 1; j >= Math.max(0, n - 6) && !sweep; j--) {
    for (const p of lows.slice(-5)) {
      if (p.i < j - 1 && c[j].low < p.price && c[j].close > p.price && !c.slice(p.i + 1, j).some((x) => x.low < p.price)) {
        sweep = { dir: 1, price: p.price, time: c[j].time };
        break;
      }
    }
    if (sweep) break;
    for (const p of highs.slice(-5)) {
      if (p.i < j - 1 && c[j].high > p.price && c[j].close < p.price && !c.slice(p.i + 1, j).some((x) => x.high > p.price)) {
        sweep = { dir: -1, price: p.price, time: c[j].time };
        break;
      }
    }
  }

  // ---------- Fibonacci dealing range ----------
  let fib: FibInfo | null = null;
  const lh = highs[highs.length - 1];
  const ll = lows[lows.length - 1];
  if (lh && ll) {
    if (ll.i < lh.i) {
      // up-leg: low -> high
      let high = lh.price;
      for (let k = ll.i; k < n; k++) high = Math.max(high, c[k].high);
      const low = ll.price;
      const rng = high - low;
      if (rng > 0)
        fib = {
          dir: 1, high, low, startTime: ll.time,
          levels: FIB_LEVELS.map((l) => ({ ...l, price: high - l.r * rng })),
          pos: (price - low) / rng,
        };
    } else {
      let low = ll.price;
      for (let k = lh.i; k < n; k++) low = Math.min(low, c[k].low);
      const high = lh.price;
      const rng = high - low;
      if (rng > 0)
        fib = {
          dir: -1, high, low, startTime: lh.time,
          levels: FIB_LEVELS.map((l) => ({ ...l, price: low + l.r * rng })),
          pos: (price - low) / rng,
        };
    }
  }

  // ---------- Confluence factors ----------
  const factors: Factor[] = [];
  factors.push({
    key: 'ms', label: 'Bozor strukturasi', weight: 20, value: trend,
    note: trend === 1 ? 'Bullish BOS/CHoCH — yuqori choʻqqilar sindirilmoqda' : trend === -1 ? 'Bearish — past choʻqqilar sindirilmoqda' : 'Struktura aniq emas',
  });
  const htf = opts.htfBias ?? 0;
  factors.push({
    key: 'htf', label: 'Katta TF yoʻnalishi', weight: 20, value: htf,
    note: htf === 1 ? 'Katta taymfreym bullish' : htf === -1 ? 'Katta taymfreym bearish' : 'Katta TF neytral',
  });
  const e50 = ema50[n - 1];
  const e200 = ema200[n - 1];
  let emaV = 0;
  if (!isNaN(e50)) {
    emaV += price > e50 ? 0.5 : -0.5;
    if (!isNaN(e200)) emaV += e50 > e200 ? 0.5 : -0.5;
    else emaV *= 2;
  }
  factors.push({
    key: 'ema', label: 'EMA 50/200 trend', weight: 15, value: emaV,
    note: emaV > 0.5 ? 'Narx EMA50 ustida, EMA50 > EMA200' : emaV < -0.5 ? 'Narx EMA50 ostida, EMA50 < EMA200' : 'EMA aralash signal',
  });
  if (fib) {
    const pd = clamp((0.5 - fib.pos) * 2.2);
    factors.push({
      key: 'pd', label: 'Premium / Discount', weight: 15, value: pd,
      note: fib.pos < 0.5 ? `Discount zonada (${(fib.pos * 100).toFixed(0)}%) — xarid uchun arzon` : `Premium zonada (${(fib.pos * 100).toFixed(0)}%) — sotuv uchun qimmat`,
    });
    const retr = fib.dir === 1 ? 1 - fib.pos : fib.pos; // retracement depth of current leg
    const inOte = retr >= 0.618 && retr <= 0.79;
    factors.push({
      key: 'ote', label: 'OTE (0.618–0.79)', weight: 10, value: inOte ? fib.dir : 0,
      note: inOte ? `Narx OTE zonasida — ${fib.dir === 1 ? 'long' : 'short'} uchun optimal kirish` : `Retreysment ${(retr * 100).toFixed(0)}% — OTE tashqarisida`,
    });
  }
  let pdV = 0;
  let pdNote = 'Yaqin atrofda FVG/OB yoʻq';
  for (const z of zones) {
    const near = price <= z.top + atr * 0.5 && price >= z.bottom - atr * 0.5;
    if (near) {
      pdV += z.dir * (z.kind === 'OB' ? 0.6 : 0.5);
      pdNote = `Narx ${z.dir === 1 ? 'bullish' : 'bearish'} ${z.kind} ichida/yonida`;
    }
  }
  factors.push({ key: 'pda', label: 'PD array (FVG / OB)', weight: 10, value: clamp(pdV), note: pdNote });
  factors.push({
    key: 'liq', label: 'Likvidlik olinishi', weight: 10, value: sweep ? sweep.dir : 0,
    note: sweep ? (sweep.dir === 1 ? 'SSL olindi (stop hunt) va qaytdi — bullish' : 'BSL olindi va qaytdi — bearish') : 'Yaqinda sweep boʻlmadi',
  });
  const r = rsiArr[n - 1];
  let rsiV = clamp((r - 50) / 20);
  if (r > 75) rsiV = -0.4;
  if (r < 25) rsiV = 0.4;
  factors.push({
    key: 'rsi', label: 'RSI momentum', weight: 5, value: rsiV,
    note: r > 75 ? `RSI ${r.toFixed(0)} — haddan tashqari xarid` : r < 25 ? `RSI ${r.toFixed(0)} — haddan tashqari sotuv` : `RSI ${r.toFixed(0)}`,
  });

  if (day.nyOpen !== null && atr) {
    // ICT: bullish kunda NY ochilishidan PASTDA xarid qilish, bearishda — USTIDA sotish
    const d = (price - day.nyOpen) / atr;
    const bias = htf || trend;
    const v = bias ? clamp(-d * 0.5) * (Math.sign(-d) === bias ? 1 : 0.5) : 0;
    factors.push({
      key: 'mo', label: 'NY Midnight Open', weight: 5, value: v,
      note: `Narx NY 00:00 ochilishidan ${d >= 0 ? 'yuqorida' : 'pastda'} (${d >= 0 ? '+' : ''}${d.toFixed(1)} ATR)${bias ? (Math.sign(-d) === bias ? ' — ICT boʻyicha qulay tomonda' : (bias === 1 ? ' — long uchun qimmat, chekinishni kuting' : ' — short uchun arzon, qaytishni kuting')) : ''}`,
    });
  }

  const wsum = factors.reduce((s, f) => s + f.weight, 0);
  const score = Math.round((factors.reduce((s, f) => s + f.value * f.weight, 0) / wsum) * 100);

  const setup = buildSetup(score, price, atr, fib, liquidity);

  return {
    price, atr, rsi: r, ema20, ema50, ema200, trend, events, pivots: confirmed, zones, liquidity, sweep, fib, factors, score, setup,
    session: sessionOf(c[n - 1].time),
    nyOpen: day.nyOpen,
    asia: day.asia,
  };
}

export const SIGNAL_THRESHOLD = 30;

function buildSetup(score: number, price: number, atr: number, fib: FibInfo | null, liq: LiquidityLevel[]): Setup | null {
  if (Math.abs(score) < SIGNAL_THRESHOLD || !atr) return null;
  const dir: Dir = score > 0 ? 1 : -1;
  const entry = price;
  let sl: number;
  if (dir === 1) {
    const anchor = fib ? fib.low : price - 1.5 * atr;
    sl = anchor < price && price - anchor < 4 * atr && price - anchor > 0.5 * atr ? anchor - 0.25 * atr : price - 1.5 * atr;
  } else {
    const anchor = fib ? fib.high : price + 1.5 * atr;
    sl = anchor > price && anchor - price < 4 * atr && anchor - price > 0.5 * atr ? anchor + 0.25 * atr : price + 1.5 * atr;
  }
  const risk = Math.abs(entry - sl);
  // TP1: nearest opposing liquidity at least 1R away
  const targets = liq
    .filter((l) => (dir === 1 ? l.price > entry + risk : l.price < entry - risk))
    .map((l) => l.price)
    .sort((a, b) => (dir === 1 ? a - b : b - a));
  let tp1 = targets[0] ?? entry + dir * 1.5 * risk;
  if (Math.abs(tp1 - entry) > 4 * risk) tp1 = entry + dir * 2 * risk;
  let tp2 = fib ? fib.levels.find((l) => l.r === -0.272)!.price : NaN;
  let tp3 = fib ? fib.levels.find((l) => l.r === -0.618)!.price : NaN;
  if (fib && fib.dir !== dir) {
    tp2 = NaN;
    tp3 = NaN;
  }
  if (!(dir * (tp2 - tp1) > 0)) tp2 = tp1 + dir * risk;
  if (!(dir * (tp3 - tp2) > 0)) tp3 = tp2 + dir * risk;
  let limitEntry: number | null = null;
  if (fib && fib.dir === dir) {
    const ote = fib.levels.find((l) => l.r === 0.705)!.price;
    if (dir * (price - ote) > 0.3 * atr) limitEntry = ote;
  }
  return { dir, entry, limitEntry, sl, tp1, tp2, tp3, rr1: Math.abs(tp1 - entry) / risk, rr2: Math.abs(tp2 - entry) / risk };
}

export function trendOf(c: Candle[]): 0 | Dir {
  const a = analyze(c, { light: true });
  if (!a) return 0;
  const e = a.factors.find((f) => f.key === 'ema')!.value;
  if (a.trend !== 0) return a.trend;
  return e > 0 ? 1 : e < 0 ? -1 : 0;
}
