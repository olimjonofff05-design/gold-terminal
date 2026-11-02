import { analyze } from '../../../src/lib/analysis.ts';
import type { Analysis, Candle, Dir } from '../../../src/lib/types.ts';
import { candleSource, candles } from '../sources/candles.ts';
import { calendar, type CalEvent } from '../sources/calendar.ts';
import { cot, macro, type Cot, type Macro } from '../sources/macro.ts';
import { clamp, nowSec, ny, nyMidnight, round } from '../util.ts';

/**
 * Kunlik brif — .claude/skills/xau-daily-brief/SKILL.md dagi qoidalarning kodi.
 * Bu yerdagi raqamlar o'zgarsa, skill ham yangilanishi kerak (va aksincha).
 */

export type Bias = 'LONG' | 'SHORT' | 'NEYTRAL';
export interface BFactor { key: string; label: string; value: number; weight: number; note: string }
export interface BZone { lo: number; hi: number; score: number; strength: 'kuchli' | "o'rta" | 'kuchsiz'; tags: string[]; side: 1 | -1 }
export interface Plan {
  dir: Dir;
  main: boolean;
  kind: 'qaytish' | 'buzilish'; // zonadan qaytish yoki zona sinib, qayta testda kirish
  zone: BZone;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp1Tag: string;
  tp2Tag: string;
  rr1: number;
  rr2: number;
}
export interface Brief {
  date: string; // NY savdo kuni
  at: number;
  source: string;
  price: number;
  changePct: number; // kechagi D1 o'zgarish
  atrD1: number;
  atrH1: number;
  bias: Bias;
  prob: number;
  score: number;
  factors: BFactor[];
  notes: string[]; // ehtimolga ta'sir qilgan izohlar
  events: CalEvent[]; // bugungi High/Medium USD voqealar
  zones: BZone[];
  plans: Plan[];
  invalid: { price: number; text: string } | null;
  nyOpen: number | null;
  pdh: number | null;
  pdl: number | null;
  macro: Macro;
  cot: Cot | null;
  narrative?: string;
}

export const MAX_PROB = 68;
export const EVENT_PROB = 55;

export async function buildBrief(): Promise<Brief> {
  const [d1, h4, h1, mac, co, cal] = await Promise.all([candles('1d', 300), candles('4h', 400), candles('1h', 500), macro(), cot(), calendar()]);
  const aD1 = analyze(d1)!;
  const aH4 = analyze(h4, { htfBias: aD1.trend })!;
  const aH1 = analyze(h1, { htfBias: aH4.trend })!;
  const price = aH1.price;
  const at = nowSec();

  // ---------- bias ----------
  const factors: BFactor[] = [];
  const emaD1 = aD1.factors.find((f) => f.key === 'ema')?.value ?? 0;
  const d1v = (aD1.trend + emaD1) / 2;
  factors.push({ key: 'd1', label: 'D1 struktura va EMA', weight: 25, value: d1v, note: d1v > 0.25 ? 'kunlik trend yuqoriga' : d1v < -0.25 ? 'kunlik trend pastga' : 'kunlik trend aniq emas' });
  factors.push({ key: 'h4', label: 'H4 struktura', weight: 20, value: aH4.trend, note: aH4.trend === 1 ? 'H4 da yuqori cho\'qqilar sindirilyapti' : aH4.trend === -1 ? 'H4 da past cho\'qqilar sindirilyapti' : 'H4 struktura aniq emas' });
  factors.push({ key: 'h1', label: 'H1 konfluens', weight: 15, value: aH1.score / 100, note: `H1 skor ${aH1.score > 0 ? '+' : ''}${aH1.score}` });
  if (mac.realYield) {
    const bp = (mac.realYield.last - mac.realYield.prev5) * 100;
    factors.push({ key: 'ry', label: 'Real stavka (5 kun)', weight: 15, value: clamp(-bp / 10), note: `real stavka 5 kunda ${bp >= 0 ? '+' : ''}${bp.toFixed(0)} b.p. (${mac.realYield.last.toFixed(2)}%)` });
  }
  if (mac.dxy) {
    const pct = (mac.dxy.last / mac.dxy.prev5 - 1) * 100;
    factors.push({ key: 'dxy', label: 'Dollar (5 kun)', weight: 10, value: clamp(-pct), note: `${mac.dxySource} 5 kunda ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` });
  }
  if (aD1.fib) {
    const pos = aD1.fib.pos;
    factors.push({ key: 'pd', label: 'Premium / Discount (D1)', weight: 10, value: clamp((0.5 - pos) * 2.2), note: pos < 0.5 ? `narx kunlik diapazonning arzon qismida (${(pos * 100).toFixed(0)}%)` : `narx kunlik diapazonning qimmat qismida (${(pos * 100).toFixed(0)}%)` });
  }
  if (co) {
    const v = co.index3y > 90 ? -1 : co.index3y < 10 ? 1 : 0;
    factors.push({ key: 'cot', label: 'COT (fondlar pozitsiyasi)', weight: 5, value: v, note: `fondlar long pozitsiyasi 3 yillik diapazonning ${co.index3y.toFixed(0)}% ida${v ? (v < 0 ? ', haddan tashqari ko\'p' : ', juda kam') : ''}` });
  }
  const wsum = factors.reduce((s, f) => s + f.weight, 0);
  const score = Math.round((factors.reduce((s, f) => s + f.value * f.weight, 0) / wsum) * 100);
  const bias: Bias = score > 25 ? 'LONG' : score < -25 ? 'SHORT' : 'NEYTRAL';
  let prob = bias === 'NEYTRAL' ? 50 : Math.round(50 + Math.min(Math.abs(score), 60) * 0.3);
  const notes: string[] = [];

  const dayEnd = nyMidnight(at) + 17 * 3600 + (ny(at).hour >= 17 ? 86400 : 0);
  const events = cal.filter((e) => e.time >= at - 1800 && e.time < dayEnd && (e.impact === 'High' || e.impact === 'Medium'));
  if (aD1.trend && aH4.trend && aD1.trend !== aH4.trend && bias !== 'NEYTRAL') {
    prob -= 5;
    notes.push('D1 va H4 trendlari bir-biriga qarshi, ehtimol pasaytirildi');
  }
  if (events.some((e) => e.impact === 'High') && prob > EVENT_PROB) {
    prob = EVENT_PROB;
    notes.push('bugun yuqori ta\'sirli yangilik bor, ehtimol 55% bilan cheklandi');
  }
  prob = Math.max(50, Math.min(MAX_PROB, prob));

  // ---------- zonalar va rejalar ----------
  const zones = pickZones(aD1, aH4, aH1, d1, price);
  const plans = buildPlans(bias, zones, price, aH1.atr, aD1.atr);
  const pd = aH1.liquidity.find((l) => l.kind === 'PDH');
  const pl = aH1.liquidity.find((l) => l.kind === 'PDL');
  const prevD = d1[d1.length - 2];

  return {
    date: ny(at).date,
    at,
    source: candleSource(),
    price,
    changePct: round(((prevD.close - d1[d1.length - 3].close) / d1[d1.length - 3].close) * 100, 2),
    atrD1: aD1.atr,
    atrH1: aH1.atr,
    bias,
    prob,
    score,
    factors,
    notes,
    events,
    zones,
    plans,
    invalid: invalidation(bias, aH4, price),
    nyOpen: aH1.nyOpen,
    pdh: pd?.price ?? prevD.high,
    pdl: pl?.price ?? prevD.low,
    macro: mac,
    cot: co,
  };
}

// ---------------- zonalar ----------------
interface Cand { lo: number; hi: number; w: number; tag: string }
const DIR_UZ = (d: Dir) => (d === 1 ? 'bullish' : 'bearish');
const LIQ_UZ: Record<string, string> = { BSL: 'BSL (stoplar)', SSL: 'SSL (stoplar)', EQH: 'teng cho\'qqilar', EQL: 'teng tubliklar', PDH: 'PDH', PDL: 'PDL', AsH: 'Osiyo high', AsL: 'Osiyo low' };

export function pickZones(aD1: Analysis, aH4: Analysis, aH1: Analysis, d1: Candle[], price: number): BZone[] {
  const c: Cand[] = [];
  const pt = (p: number, w: number, tag: string) => c.push({ lo: p, hi: p, w, tag });
  for (const l of aH1.liquidity) pt(l.price, l.kind === 'PDH' || l.kind === 'PDL' ? 2 : 1, ['BSL', 'SSL', 'EQH', 'EQL'].includes(l.kind) ? `H1 ${LIQ_UZ[l.kind]}` : LIQ_UZ[l.kind]);
  for (const l of aH4.liquidity) if (['BSL', 'SSL', 'EQH', 'EQL'].includes(l.kind)) pt(l.price, 2, `H4 ${LIQ_UZ[l.kind]}`);
  if (aH1.nyOpen !== null) pt(aH1.nyOpen, 1, 'NY ochilishi');
  for (const z of aH1.zones) c.push({ lo: z.bottom, hi: z.top, w: 1, tag: `H1 ${DIR_UZ(z.dir)} ${z.kind}` });
  for (const z of aH4.zones) c.push({ lo: z.bottom, hi: z.top, w: 2, tag: `H4 ${DIR_UZ(z.dir)} ${z.kind}` });
  for (const z of aD1.zones) c.push({ lo: z.bottom, hi: z.top, w: 2, tag: `D1 ${DIR_UZ(z.dir)} ${z.kind}` });
  const pw = prevWeek(d1);
  if (pw) {
    pt(pw.high, 2, 'haftalik high');
    pt(pw.low, 2, 'haftalik low');
  }
  if (aH4.fib) {
    const a = aH4.fib.levels.find((l) => l.r === 0.618)!.price;
    const b = aH4.fib.levels.find((l) => l.r === 0.786)!.price;
    c.push({ lo: Math.min(a, b), hi: Math.max(a, b), w: 2, tag: 'H4 OTE' });
  }
  const span = 3 * aD1.atr;
  for (let r = Math.ceil((price - span) / 25) * 25; r <= price + span; r += 25) pt(r, r % 50 === 0 ? 1 : 0.5, `${r} yumaloq`);

  const atr = aH1.atr;
  const near = c.filter((x) => Math.abs((x.lo + x.hi) / 2 - price) <= span && x.hi - x.lo < 2.5 * atr).sort((a, b) => a.lo - b.lo);
  const clusters: Cand[][] = [];
  for (const x of near) {
    const cur = clusters[clusters.length - 1];
    if (cur && x.lo <= Math.max(...cur.map((y) => y.hi)) + 0.3 * atr) cur.push(x);
    else clusters.push([x]);
  }
  const zones: BZone[] = clusters.map((cl) => {
    const tags = [...new Set(cl.map((x) => x.tag))];
    const score = tags.reduce((s, t) => s + cl.find((x) => x.tag === t)!.w, 0);
    const lo = Math.min(...cl.map((x) => x.lo));
    const hi = Math.max(...cl.map((x) => x.hi));
    return { lo, hi, score, tags, strength: score >= 4 ? 'kuchli' : score >= 2 ? "o'rta" : 'kuchsiz', side: (lo + hi) / 2 > price ? 1 : -1 };
  });
  const dist = (z: BZone) => Math.abs((z.lo + z.hi) / 2 - price);
  const side = (s: 1 | -1) =>
    zones
      .filter((z) => z.side === s && z.score >= 1)
      .sort((a, b) => b.score - a.score || dist(a) - dist(b))
      .slice(0, 3)
      .sort((a, b) => dist(a) - dist(b));
  return [...side(1), ...side(-1)];
}

function prevWeek(d1: Candle[]) {
  const wk = (t: number) => Math.floor((t / 86400 + 3) / 7); // dushanbadan boshlanuvchi hafta raqami
  const cur = wk(d1[d1.length - 1].time);
  const w = d1.filter((x) => wk(x.time) === cur - 1);
  return w.length ? { high: Math.max(...w.map((x) => x.high)), low: Math.min(...w.map((x) => x.low)) } : null;
}

// ---------------- rejalar ----------------
const MIN_RR = 1.5;

export function buildPlans(bias: Bias, zones: BZone[], price: number, atr: number, atrD1: number): Plan[] {
  // reja faqat bugun yetib borish mumkin bo'lgan zonalarga: narxdan 1.5 ATR(D1) ichida
  const inReach = (z: BZone) => Math.abs((z.lo + z.hi) / 2 - price) <= 1.5 * atrD1;
  // bias tomonida o'rta/kuchli zona bo'lmasa, 1.5+ ballilar ham olinadi — aks holda asosiy reja umuman chiqmaydi
  const sideZones = (s: 1 | -1, minScore: number) => zones.filter((z) => z.side === s && inReach(z) && z.score >= minScore);
  const pick = (s: 1 | -1, primary: boolean) => (sideZones(s, 2).length || !primary ? sideZones(s, 2) : sideZones(s, 1.5));
  const above = pick(1, bias !== 'LONG');
  const below = pick(-1, bias !== 'SHORT');
  const out: Plan[] = [];
  const add = (z: BZone | undefined, dir: Dir, main: boolean, kind: Plan['kind'] = 'qaytish') => {
    if (!z) return;
    const p = planAt(z, dir, main, zones, price, atr, kind);
    if (p) out.push(p);
  };
  if (bias === 'LONG') {
    add(below[0], 1, true);
    add(below[1], 1, true);
    add(above[0], -1, false);
    // tepada qaytish zonasi yo'q bo'lsa: qarshilik sinib, qayta testda long
    if (!out.some((p) => p.main)) add(above[0], 1, true, 'buzilish');
  } else if (bias === 'SHORT') {
    add(above[0], -1, true);
    add(above[1], -1, true);
    add(below[0], 1, false);
    // tepada sotish zonasi yo'q bo'lsa: support sinib, qayta testda short
    if (!out.some((p) => p.main)) add(below[0], -1, true, 'buzilish');
  } else {
    add(above[0], -1, true);
    add(below[0], 1, true);
  }
  return out.sort((a, b) => Number(b.main) - Number(a.main));
}

function planAt(z: BZone, dir: Dir, main: boolean, zones: BZone[], price: number, atr: number, kind: Plan['kind']): Plan | null {
  // qaytish: zona o'rtasidan, SL zona ortida; buzilish: zonaning sindirilgan chetidan, SL zonaning narigi chetida
  const entry = kind === 'qaytish' ? (z.lo + z.hi) / 2 : dir === 1 ? z.hi : z.lo;
  let sl = (dir === 1) === (kind === 'qaytish') ? z.lo - 0.25 * atr : z.hi + 0.25 * atr;
  if (Math.abs(entry - sl) < 0.8 * atr) sl = entry - dir * 0.8 * atr; // oltinda juda yaqin SL shovqindan uriladi
  const risk = Math.abs(entry - sl);
  // maqsadlar: kirishdan keyingi tomonda turgan zonalar (narxning o'zi ham — qaytish nuqtasi)
  const targets = zones
    .filter((x) => x !== z)
    .map((x) => ({ p: dir === 1 ? x.lo : x.hi, tag: x.tags[0] }))
    .concat(dir * (price - entry) > 0 ? [{ p: price, tag: 'hozirgi narx' }] : [])
    .filter((t) => dir * (t.p - entry) > 0)
    .sort((a, b) => dir * (a.p - b.p));
  const rr = (p: number) => Math.abs(p - entry) / risk;
  let t1 = targets.find((t) => rr(t.p) >= MIN_RR && rr(t.p) <= 5);
  if (!t1) t1 = { p: entry + dir * 2 * risk, tag: '2R' };
  let t2 = targets.find((t) => rr(t.p) >= rr(t1!.p) + 0.8 && rr(t.p) <= 8);
  if (!t2) t2 = { p: entry + dir * (rr(t1.p) + 1.2) * risk, tag: `${(rr(t1.p) + 1.2).toFixed(1)}R` };
  if (rr(t1.p) < MIN_RR) return null;
  return { dir, main, kind, zone: z, entry, sl, tp1: t1.p, tp2: t2.p, tp1Tag: t1.tag, tp2Tag: t2.tag, rr1: round(rr(t1.p), 1), rr2: round(rr(t2.p), 1) };
}

/** Ssenariy bekor bo'lishi — oxirgi H4 tebranish nuqtasi (struktura buzilsa, bias ham buziladi) */
function invalidation(bias: Bias, aH4: Analysis, price: number): Brief['invalid'] {
  const piv = aH4.pivots;
  if (bias === 'LONG') {
    const l = [...piv].reverse().find((p) => p.type === 'L' && p.price < price);
    return l ? { price: l.price, text: 'H4 shami oxirgi H4 tubligidan pastda yopilsa, long ssenariy bekor' } : null;
  }
  if (bias === 'SHORT') {
    const h = [...piv].reverse().find((p) => p.type === 'H' && p.price > price);
    return h ? { price: h.price, text: "H4 shami oxirgi H4 cho'qqisidan yuqorida yopilsa, short ssenariy bekor" } : null;
  }
  return null;
}
