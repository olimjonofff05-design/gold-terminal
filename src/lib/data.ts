import type { Candle } from './types';

/**
 * Narx manbalari
 * ----------------
 * Oldin XAU/USD narxi Binance spot'dagi PAXG tokenidan olinardi. PAXG — kripto
 * birjadagi alohida aktiv: u 24/7 savdolanadi, o'z buyurtma kitobiga ega va
 * spot oltindan ko'pincha 0.3–3% (ba'zan undan ham ko'p) premium/discount bilan
 * turadi. Shu sababli sayt narxi TradingView (OANDA:XAUUSD) dan ~$100+ farq qilardi.
 *
 * Endi XAU/USD Binance USDⓈ-M Futures'dagi XAUUSDT perpetual kontraktidan olinadi —
 * u spot oltin indeksini kuzatadi (funding mexanizmi orqali spotga bog'langan) va
 * OANDA / FX brokerlar narxiga bir necha sent–dollar aniqlikda mos keladi.
 * Agar futures API ochilmasa — PAXG zaxira manba sifatida ishlatiladi va bu UI'da
 * aniq ko'rsatiladi.
 */

export type Market = 'spot' | 'futures';

export interface Feed {
  stream: string; // Binance symbol
  market: Market;
  name: string; // UI uchun manba nomi
}

export interface SymbolInfo {
  id: string;
  label: string;
  sub: string;
  primary: Feed;
  fallback?: Feed;
  digits: number;
  unit: string;
  demoBase: number;
  metal?: boolean; // haqiqiy bozor soatlariga ega (oltin)
}

export const SYMBOLS: SymbolInfo[] = [
  {
    id: 'XAUUSD', label: 'XAU/USD', sub: 'Oltin · spot', digits: 2, unit: 'oz', demoBase: 4025, metal: true,
    primary: { stream: 'XAUUSDT', market: 'futures', name: 'Binance XAUUSDT (spot oltin)' },
    fallback: { stream: 'PAXGUSDT', market: 'spot', name: 'PAXG token (taxminiy)' },
  },
  { id: 'BTCUSD', label: 'BTC/USD', sub: 'Bitcoin', primary: { stream: 'BTCUSDT', market: 'spot', name: 'Binance spot' }, digits: 2, unit: 'BTC', demoBase: 80000 },
  { id: 'ETHUSD', label: 'ETH/USD', sub: 'Ethereum', primary: { stream: 'ETHUSDT', market: 'spot', name: 'Binance spot' }, digits: 2, unit: 'ETH', demoBase: 3000 },
  { id: 'SOLUSD', label: 'SOL/USD', sub: 'Solana', primary: { stream: 'SOLUSDT', market: 'spot', name: 'Binance spot' }, digits: 3, unit: 'SOL', demoBase: 150 },
  { id: 'BNBUSD', label: 'BNB/USD', sub: 'BNB', primary: { stream: 'BNBUSDT', market: 'spot', name: 'Binance spot' }, digits: 2, unit: 'BNB', demoBase: 900 },
  { id: 'XRPUSD', label: 'XRP/USD', sub: 'Ripple', primary: { stream: 'XRPUSDT', market: 'spot', name: 'Binance spot' }, digits: 4, unit: 'XRP', demoBase: 2.2 },
];

/** PAXG — faqat taqqoslash (premium) uchun kuzatiladi */
const PAXG: Feed = { stream: 'PAXGUSDT', market: 'spot', name: 'PAXG' };

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type TF = (typeof TIMEFRAMES)[number];
export const HTF: Record<TF, string> = { '1m': '15m', '5m': '1h', '15m': '4h', '1h': '4h', '4h': '1d', '1d': '1w' };
export const TF_SEC: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };

const HOSTS: Record<Market, { rest: string[]; path: string; ws: string[] }> = {
  spot: {
    rest: ['https://api.binance.com', 'https://data-api.binance.vision'],
    path: '/api/v3/klines',
    ws: ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'],
  },
  futures: {
    rest: ['https://fapi.binance.com'],
    path: '/fapi/v1/klines',
    ws: ['wss://fstream.binance.com', 'wss://fstream.binance.com/market'],
  },
};

// ---------------- demo / source state ----------------
let demo = false;
const demoListeners = new Set<(d: boolean) => void>();
export const isDemo = () => demo;
export function onDemoChange(fn: (d: boolean) => void) {
  demoListeners.add(fn);
  return () => demoListeners.delete(fn);
}
function setDemo(v: boolean) {
  if (demo === v) return;
  demo = v;
  demoListeners.forEach((f) => f(v));
}

/** Har bir simvol uchun hozir qaysi feed ishlatilayotgani */
const active = new Map<string, Feed>();
const srcListeners = new Set<() => void>();
export const feedOf = (s: SymbolInfo): Feed => active.get(s.id) ?? s.primary;
export const usingFallback = (s: SymbolInfo) => !!s.fallback && feedOf(s) === s.fallback;
export function onSourceChange(fn: () => void) {
  srcListeners.add(fn);
  return () => srcListeners.delete(fn);
}
function setActive(id: string, f: Feed) {
  if (active.get(id) === f) return;
  active.set(id, f);
  srcListeners.forEach((x) => x());
}

const toCandle = (k: (string | number)[]): Candle => ({
  time: Math.floor(Number(k[0]) / 1000),
  open: +k[1],
  high: +k[2],
  low: +k[3],
  close: +k[4],
  volume: +k[5],
});

async function restKlines(f: Feed, tf: string, limit: number): Promise<Candle[] | null> {
  const h = HOSTS[f.market];
  for (const host of h.rest) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(`${host}${h.path}?symbol=${f.stream}&interval=${tf}&limit=${Math.min(limit, 1500)}`, { signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j) && j.length) return j.map(toCandle);
    } catch {
      /* keyingi host */
    }
  }
  return null;
}

export async function fetchKlines(sym: SymbolInfo, tf: string, limit = 1000): Promise<Candle[]> {
  if (!demo) {
    const order = [feedOf(sym), sym.primary, sym.fallback].filter((x, i, a): x is Feed => !!x && a.indexOf(x) === i);
    for (const f of order) {
      const cs = await restKlines(f, tf, limit);
      if (cs) {
        setActive(sym.id, f);
        return cs;
      }
    }
    setDemo(true);
  }
  return demoKlines(sym, tf, limit);
}

// ---------------- live streams ----------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function openWs(market: Market, path: string, onMsg: (d: any) => void): () => void {
  const hosts = HOSTS[market].ws;
  let closed = false;
  let ws: WebSocket | null = null;
  let hostIdx = 0;
  let retry = 0;
  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket(`${hosts[hostIdx % hosts.length]}${path}`);
    } catch {
      setDemo(true);
      return;
    }
    let opened = false;
    ws.onopen = () => { opened = true; retry = 0; };
    ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch { /* ignore */ } };
    ws.onclose = () => {
      if (closed) return;
      if (!opened) hostIdx++;
      retry++;
      setTimeout(connect, Math.min(10000, 800 * retry));
    };
  };
  connect();
  return () => { closed = true; ws?.close(); };
}

export function subscribeKline(sym: SymbolInfo, tf: string, cb: (c: Candle) => void): () => void {
  if (demo) return demoKlineStream(sym, tf, cb);
  const f = feedOf(sym);
  return openWs(f.market, `/ws/${f.stream.toLowerCase()}@kline_${tf}`, (d) => {
    const k = d.k;
    if (!k) return;
    cb({ time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
  });
}

export interface Tick { price: number; change: number; open: number }
export const PAXG_ID = 'PAXG';

/** Barcha simvollar + PAXG (premium uchun) narxlari. Spot va futures alohida oqimda. */
export function subscribeTickers(cb: (id: string, t: Tick) => void): () => void {
  if (demo) return demoTickerStream(cb);
  const groups: Record<Market, { feed: Feed; id: string }[]> = { spot: [], futures: [] };
  for (const s of SYMBOLS) groups[feedOf(s).market].push({ feed: feedOf(s), id: s.id });
  groups.spot.push({ feed: PAXG, id: PAXG_ID });
  const subs: (() => void)[] = [];
  (Object.keys(groups) as Market[]).forEach((m) => {
    const g = groups[m];
    if (!g.length) return;
    const streams = [...new Set(g.map((x) => `${x.feed.stream.toLowerCase()}@miniTicker`))].join('/');
    subs.push(
      openWs(m, `/stream?streams=${streams}`, (msg) => {
        const d = msg.data;
        if (!d) return;
        for (const x of g) if (x.feed.stream === d.s) cb(x.id, { price: +d.c, open: +d.o, change: ((+d.c - +d.o) / +d.o) * 100 });
      }),
    );
  });
  return () => subs.forEach((u) => u());
}

export interface Book { bid: number; ask: number }
/** Joriy simvol uchun eng yaxshi bid / ask (TradingView'dagi SOTISH / SOTIB OLISH kabi) */
export function subscribeBook(sym: SymbolInfo, cb: (b: Book) => void): () => void {
  if (demo) {
    const id = setInterval(() => {
      const p = demoPrice.get(sym.id) ?? sym.demoBase;
      const half = p * 0.00004;
      cb({ bid: p - half, ask: p + half });
    }, 1000);
    return () => clearInterval(id);
  }
  const f = feedOf(sym);
  return openWs(f.market, `/ws/${f.stream.toLowerCase()}@bookTicker`, (d) => {
    if (d.b && d.a) cb({ bid: +d.b, ask: +d.a });
  });
}

// ---------------- gold market hours ----------------
const nyFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
/** Nyu-York vaqti (DST hisobga olingan) */
export function nyParts(tSec: number) {
  const p = Object.fromEntries(nyFmt.formatToParts(new Date(tSec * 1000)).map((x) => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000;
  return { hour: +p.hour, minute: +p.minute, weekday: p.weekday as string, offset: local - Math.floor(tSec) };
}

/**
 * Spot oltin (OTC / CME Globex) savdo soatlari: Yakshanba 18:00 — Juma 17:00 NY,
 * har kuni 17:00–18:00 NY tanaffus. XAUUSDT perpetual esa 24/7 savdolanadi —
 * dam olish kunlari undagi harakatlar dushanba ochilishida "gap" bo'lishi mumkin.
 */
export function goldMarket(now = Date.now() / 1000): { open: boolean; label: string } {
  const { hour, weekday } = nyParts(now);
  if (weekday === 'Sat') return { open: false, label: 'Bozor yopiq · dam olish' };
  if (weekday === 'Sun' && hour < 18) return { open: false, label: 'Bozor yopiq · 18:00 NY da ochiladi' };
  if (weekday === 'Fri' && hour >= 17) return { open: false, label: 'Bozor yopiq · dam olish' };
  if (hour === 17) return { open: false, label: 'Kunlik tanaffus · 18:00 NY' };
  return { open: true, label: 'Bozor ochiq' };
}

// ---------------- demo (offline) data ----------------
const demoPrice = new Map<string, number>();
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
function demoKlines(sym: SymbolInfo, tf: string, limit: number): Candle[] {
  const step = TF_SEC[tf] ?? 3600;
  const now = Math.floor(Date.now() / 1000 / step) * step;
  const r = rng(sym.id.length * 7919 + step);
  const vol = sym.demoBase * 0.0018 * Math.sqrt(step / 300);
  let p = sym.demoBase * (0.92 + r() * 0.08);
  let drift = 0;
  const out: Candle[] = [];
  for (let i = limit - 1; i >= 0; i--) {
    if (r() < 0.04) drift = (r() - 0.5) * vol * 0.35;
    const o = p;
    const c = o + drift + (r() - 0.5) * vol * 2;
    const h = Math.max(o, c) + r() * vol * 0.8;
    const l = Math.min(o, c) - r() * vol * 0.8;
    out.push({ time: now - i * step, open: o, high: h, low: l, close: c, volume: 100 + r() * 900 });
    p = c;
  }
  const target = demoPrice.get(sym.id);
  if (target) {
    const k = target / p;
    for (const c of out) { c.open *= k; c.high *= k; c.low *= k; c.close *= k; }
  } else demoPrice.set(sym.id, p);
  return out;
}
function demoKlineStream(sym: SymbolInfo, tf: string, cb: (c: Candle) => void) {
  const step = TF_SEC[tf] ?? 3600;
  let cur: Candle | null = null;
  const id = setInterval(() => {
    const p0 = demoPrice.get(sym.id) ?? sym.demoBase;
    const p = p0 * (1 + (Math.random() - 0.5) * 0.0012);
    demoPrice.set(sym.id, p);
    const t = Math.floor(Date.now() / 1000 / step) * step;
    if (!cur || cur.time !== t) cur = { time: t, open: p0, high: Math.max(p0, p), low: Math.min(p0, p), close: p, volume: 0 };
    else cur = { ...cur, high: Math.max(cur.high, p), low: Math.min(cur.low, p), close: p, volume: cur.volume + Math.random() * 10 };
    cb(cur);
  }, 1000);
  return () => clearInterval(id);
}
function demoTickerStream(cb: (id: string, t: Tick) => void) {
  const open = new Map<string, number>();
  const id = setInterval(() => {
    for (const s of SYMBOLS) {
      const p = demoPrice.get(s.id) ?? s.demoBase;
      if (!open.has(s.id)) open.set(s.id, p * (1 - (Math.random() - 0.5) * 0.04));
      const np = p * (1 + (Math.random() - 0.5) * 0.0006);
      demoPrice.set(s.id, np);
      const o = open.get(s.id)!;
      cb(s.id, { price: np, open: o, change: ((np - o) / o) * 100 });
    }
  }, 1000);
  return () => clearInterval(id);
}

export const fmt = (v: number, d: number) =>
  isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
