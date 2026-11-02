import type { Candle } from '../../../src/lib/types.ts';
import { candlesFrom } from '../sources/candles.ts';
import { releaseDates } from '../sources/macro.ts';
import { nyParts } from '../../../src/lib/data.ts';
import { ny, nyMidnight } from '../util.ts';
import type { Brief, Plan } from './build.ts';

export type PlanResult = 'ishga tushmadi' | 'TP2' | 'TP1' | 'SL' | 'ochiq';
export interface Evaluation {
  date: string;
  bias: Brief['bias'];
  prob: number;
  biasOk: boolean;
  close: number;
  ref: number; // solishtirish narxi (NY ochilishi)
  plans: { dir: 1 | -1; main: boolean; entry: number; result: PlanResult; r: number }[];
}

/**
 * Kun yakunida (NY 17:00) brifni baholash — SKILL.md 7-bo'lim.
 * Reja "ishga tushdi" = narx zonaga kirdi. Bitta shamda SL va TP ikkalasi bo'lsa — SL (ehtiyotkor).
 */
export async function evaluate(b: Brief): Promise<Evaluation | null> {
  const close17 = nyMidnight(b.at) + 17 * 3600 + (ny(b.at).hour >= 17 ? 86400 : 0);
  if (Date.now() / 1000 < close17) return null;
  const c = (await candlesFrom('15m', b.at, 200)).filter((x) => x.time < close17);
  if (c.length < 4) return null;
  const close = c[c.length - 1].close;
  const ref = b.nyOpen ?? c[0].open;
  let biasOk: boolean;
  if (b.bias === 'LONG') biasOk = close > ref;
  else if (b.bias === 'SHORT') biasOk = close < ref;
  else biasOk = b.pdh !== null && b.pdl !== null ? close <= b.pdh && close >= b.pdl : Math.abs(close - ref) < b.atrD1 * 0.3;
  return {
    date: b.date,
    bias: b.bias,
    prob: b.prob,
    biasOk,
    close,
    ref,
    plans: b.plans.map((p) => {
      const { result, r } = runPlan(p, c);
      return { dir: p.dir, main: p.main, entry: p.entry, result, r };
    }),
  };
}

function runPlan(p: Plan, c: Candle[]): { result: PlanResult; r: number } {
  let i: number;
  if (p.kind === 'buzilish') {
    // avval M15 zonadan narida yopilishi, keyin kirish narxiga qaytib tegishi kerak
    const brk = c.findIndex((k) => (p.dir === -1 ? k.close < p.zone.lo : k.close > p.zone.hi));
    i = brk < 0 ? -1 : c.findIndex((k, j) => j > brk && (p.dir === -1 ? k.high >= p.entry : k.low <= p.entry));
  } else i = c.findIndex((k) => k.low <= p.zone.hi && k.high >= p.zone.lo);
  if (i < 0) return { result: 'ishga tushmadi', r: 0 };
  let tp1 = false;
  for (; i < c.length; i++) {
    const k = c[i];
    const hit = (lvl: number, sideUp: boolean) => (sideUp ? k.high >= lvl : k.low <= lvl);
    if (!tp1) {
      if (hit(p.sl, p.dir === -1)) return { result: 'SL', r: -1 };
      if (hit(p.tp1, p.dir === 1)) tp1 = true;
    }
    if (tp1) {
      // TP1 dan keyin SL zararsizlikka (kirish narxiga) ko'chiriladi
      if (hit(p.tp2, p.dir === 1)) return { result: 'TP2', r: p.rr2 };
      if (hit(p.entry, p.dir === -1)) return { result: 'TP1', r: p.rr1 / 2 }; // yarmi TP1 da yopilgan, qolgani 0 da
    }
  }
  return tp1 ? { result: 'TP1', r: p.rr1 / 2 } : { result: 'ochiq', r: 0 };
}

// ---------------- yangilik kunlaridagi tarixiy harakat ----------------
export interface MoveStats { n: number; avg: number; max: number }
/** FRED release_id: 50 — NFP, 10 — CPI. E'londan keyingi 60 daqiqa (4 ta M15 sham) high-low. */
export async function eventMoves(releaseId: number, hour = 8, minute = 30, n = 12): Promise<MoveStats | null> {
  const now = Date.now() / 1000;
  const dates = (await releaseDates(releaseId, n + 4)).map((d) => toNy(d, hour, minute)).filter((t) => t < now - 3600).slice(0, n);
  const moves: number[] = [];
  for (const t of dates) {
    try {
      const c = await candlesFrom('15m', t, 4);
      if (c.length === 4 && c[0].time === t) moves.push(Math.max(...c.map((x) => x.high)) - Math.min(...c.map((x) => x.low)));
    } catch {
      /* tarix yo'q */
    }
  }
  if (!moves.length) return null;
  return { n: moves.length, avg: moves.reduce((a, b) => a + b, 0) / moves.length, max: Math.max(...moves) };
}

/** "2026-11-06", 8:30 NY -> unix sekund */
function toNy(date: string, h: number, m: number) {
  const [y, mo, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m) / 1000;
  return guess - nyParts(guess + 5 * 3600).offset;
}
