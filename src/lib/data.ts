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

export type Market = 'spot' | 'futures' | 'mt5';

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
  spotCalibrate?: boolean; // perp/token narxini spot oltin (OANDA/TradingView) ga moslash
}

export const SYMBOLS: SymbolInfo[] = [
  {
    id: 'XAUUSD', label: 'XAU/USD', sub: 'Oltin', digits: 2, unit: 'oz', demoBase: 4025, metal: true, spotCalibrate: true,
    primary: { stream: 'XAUUSDT', market: 'futures', name: 'Binance XAUUSDT' },
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

const HOSTS: Record<Exclude<Market, 'mt5'>, { rest: string[]; path: string; ws: string[] }> = {
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
// ---------------- MT5 ko'prigi (mt5-bridge/aurum_bridge.py) ----------------
/**
 * Broker rejimida kompyuterdagi MT5 (masalan Exness) dan narx olinadi: http://127.0.0.1:8765.
 * Bitta broker hisobida narx barcha qurilmalarda bir xil — sayt telefondagi MT5 bilan mos keladi.
 * Ko'prik faqat Broker rejimida tekshiriladi (boshqa paytda brauzer lokal tarmoq ruxsatini so'ramasin).
 */
export const MT5_URL = 'http://127.0.0.1:8765';
export interface BridgeInfo { symbol: string; broker: string; server: string }
let bridge: BridgeInfo | null = null;
export const getBridge = () => bridge;
const MT5_FEED: Feed = { stream: 'MT5', market: 'mt5', name: 'MT5' };
async function mt5Get<T>(path: string, ms = 2500): Promise<T | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const r = await fetch(MT5_URL + path, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}
function setBridge(b: BridgeInfo | null) {
  const changed = (bridge?.symbol ?? '') !== (b?.symbol ?? '') || (bridge?.server ?? '') !== (b?.server ?? '');
  bridge = b;
  if (changed) srcListeners.forEach((x) => x());
}
async function probeBridge() {
  if (priceMode !== 'broker') return setBridge(null);
  const h = await mt5Get<{ ok: boolean; symbol: string; broker: string; server: string }>('/health', 1500);
  setBridge(h && h.ok && h.symbol ? { symbol: h.symbol, broker: h.broker, server: h.server } : null);
}
let bridgeTimer = 0;
export async function startBridgeProbe() {
  clearInterval(bridgeTimer);
  bridgeTimer = window.setInterval(probeBridge, 8000);
  await probeBridge();
}

export const feedOf = (s: SymbolInfo): Feed =>
  s.spotCalibrate && priceMode === 'broker' && bridge ? MT5_FEED : active.get(s.id) ?? s.primary;
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
  if (f.market === 'mt5') return null;
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

// ---------------- spot calibration ----------------
/**
 * XAUUSDT perpetual spotni kuzatadi, lekin funding va USDT/USD kursi tufayli odatda
 * spotdan $3–10 yuqori/past turadi (basis). TradingView'dagi OANDA:XAUUSD bilan bir xil
 * raqam ko'rsatish uchun spot oltin narxini (gold-api.com, kalitsiz, CORS ochiq) har 15 soniyada
 * olamiz va basis = feed_narx − spot ni hisoblab, barcha shamlar / tikerlar / bid-ask dan ayiramiz.
 * Bozor yopiq paytda (dam olish) spot muzlaydi — basis ham muzlatiladi.
 */
const SPOT_URL = 'https://api.gold-api.com/price/XAU';
export interface SpotRef { spot: number; feedPx: number; basis: number; at: number; ok: boolean }
let spotRef: SpotRef | null = null;
const basisBy = new Map<string, number>(); // feed.stream -> smoothed basis
const spotListeners = new Set<() => void>();
export const getSpotRef = () => spotRef;
export function onSpotRef(fn: () => void) {
  spotListeners.add(fn);
  return () => spotListeners.delete(fn);
}
async function lastPrice(f: Feed): Promise<number | null> {
  if (f.market === 'mt5') return null;
  const url = f.market === 'futures'
    ? `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${f.stream}`
    : `https://api.binance.com/api/v3/ticker/price?symbol=${f.stream}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    return +j.price || null;
  } catch {
    return null;
  }
}
let spotTimer = 0;
let spotFirst: Promise<void> | null = null;
async function pollSpot() {
  const sym = SYMBOLS.find((x) => x.spotCalibrate);
  if (!sym || demo) return;
  const f = feedOf(sym).market === 'mt5' ? active.get(sym.id) ?? sym.primary : feedOf(sym);
  try {
    const [sr, fp] = await Promise.all([
      fetch(SPOT_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      lastPrice(f),
    ]);
    const spot = sr ? +sr.price : NaN;
    if (!isFinite(spot) || !spot || !fp) {
      if (spotRef) spotRef = { ...spotRef, ok: false };
      return;
    }
    const raw = fp - spot;
    const prev = basisBy.get(f.stream);
    // spot yopiq bo'lsa basisni yangilamaymiz; aks holda silliqlash (sakrashlarsiz)
    const open = goldMarket().open;
    const b = prev === undefined ? raw : open ? prev * 0.7 + raw * 0.3 : prev;
    // aql chegarasi: 2% dan katta farq — noto'g'ri ma'lumot, e'tiborsiz
    if (Math.abs(raw / spot) < 0.02) basisBy.set(f.stream, b);
    spotRef = { spot, feedPx: fp, basis: basisBy.get(f.stream) ?? 0, at: Date.now(), ok: true };
  } finally {
    spotListeners.forEach((x) => x());
  }
}
function ensureSpot(): Promise<void> {
  if (!spotFirst) {
    spotFirst = pollSpot();
    spotTimer = window.setInterval(pollSpot, 15000);
  }
  return spotFirst;
}
/** feed narxidan ayiriladigan qiymat (spotga moslash) */
/**
 * Narx rejimi. 'futures' (standart) — XAUUSDT perpetualning o'z narxi, ya'ni Binance Futures'da
 * savdo qilinadigan aynan shu raqam. 'spot' — grafik spot oltinga (OANDA/TradingView) suriladi.
 */
export type PriceMode = 'futures' | 'spot' | 'broker';
let priceMode: PriceMode = 'futures';
export const getPriceMode = () => priceMode;
export function setPriceMode(m: PriceMode) {
  if (priceMode === m) return;
  priceMode = m;
  if (m !== 'broker') bridge = null;
  srcListeners.forEach((x) => x());
}

/**
 * Broker kalibrlash (ko'priksiz zaxira): foydalanuvchi telefondagi MT5 dan SELL (Bid) va BUY (Ask)
 * narxini kiritadi. Spotga moslangan narx bilan farq eslab qolinadi va grafikka qo'shiladi.
 */
export interface BrokerCal { offset: number; spread: number; at: number }
const CAL_KEY = 'gold-terminal.broker.v1';
let brokerCal: BrokerCal | null = (() => {
  try {
    return JSON.parse(localStorage.getItem(CAL_KEY) || 'null');
  } catch {
    return null;
  }
})();
export const getBrokerCal = () => brokerCal;
export function setBrokerCal(c: BrokerCal | null) {
  brokerCal = c;
  try {
    if (c) localStorage.setItem(CAL_KEY, JSON.stringify(c));
    else localStorage.removeItem(CAL_KEY);
  } catch {
    /* ignore */
  }
  srcListeners.forEach((x) => x());
}
export const startSpotRef = () => ensureSpot();
/** feed narxidan ayiriladigan qiymat */
export const basisOf = (sym: SymbolInfo) => {
  if (!sym.spotCalibrate || demo || priceMode === 'futures') return 0;
  const f = feedOf(sym);
  if (f.market === 'mt5') return 0; // MT5 — brokerning o'z narxi, tuzatish kerak emas
  const spot = basisBy.get(f.stream) ?? 0;
  return priceMode === 'broker' ? spot - (brokerCal?.offset ?? 0) : spot;
};
const shift = (c: Candle, b: number): Candle => (b ? { ...c, open: c.open - b, high: c.high - b, low: c.low - b, close: c.close - b } : c);
export const isCalibrated = (sym: SymbolInfo) => priceMode !== 'futures' && !!sym.spotCalibrate && !demo && feedOf(sym).market !== 'mt5' && basisBy.has(feedOf(sym).stream);
export function stopSpot() {
  clearInterval(spotTimer);
}

export async function fetchKlines(sym: SymbolInfo, tf: string, limit = 1000): Promise<Candle[]> {
  if (feedOf(sym).market === 'mt5') {
    const j = await mt5Get<(string | number)[][]>(`/klines?interval=${tf}&limit=${limit}`, 6000);
    if (j && j.length) return j.map(toCandle);
    setBridge(null); // ko'prik javob bermadi — oddiy manbaga qaytamiz
  }
  if (!demo) {
    const order = [feedOf(sym), sym.primary, sym.fallback].filter((x, i, a): x is Feed => !!x && a.indexOf(x) === i);
    for (const f of order) {
      if (f.market === 'mt5') continue;
      const cs = await restKlines(f, tf, limit);
      if (cs) {
        setActive(sym.id, f);
        if (sym.spotCalibrate && priceMode !== 'futures') {
          // birinchi spot o'lchovini kutamiz (ko'pi bilan 5 s), keyin tarixni moslaymiz
          await Promise.race([ensureSpot(), new Promise((r) => setTimeout(r, 5000))]);
          const b = basisOf(sym);
          return b ? cs.map((c) => shift(c, b)) : cs;
        }
        return cs;
      }
    }
    setDemo(true);
  }
  return demoKlines(sym, tf, limit);
}

// ---------------- live streams ----------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function openWs(market: Exclude<Market, 'mt5'>, path: string, onMsg: (d: any) => void): () => void {
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

function poll(ms: number, fn: () => Promise<void>): () => void {
  let dead = false;
  let busy = false;
  const id = setInterval(async () => {
    if (dead || busy) return;
    busy = true;
    try { await fn(); } finally { busy = false; }
  }, ms);
  return () => { dead = true; clearInterval(id); };
}
interface Mt5Tick { bid: number; ask: number; time: number; dayOpen: number | null }

export function subscribeKline(sym: SymbolInfo, tf: string, cb: (c: Candle) => void): () => void {
  const f = feedOf(sym);
  if (f.market === 'mt5') {
    return poll(1000, async () => {
      const j = await mt5Get<(string | number)[][]>(`/klines?interval=${tf}&limit=2`);
      if (j) for (const k of j) cb(toCandle(k));
    });
  }
  if (demo) return demoKlineStream(sym, tf, cb);
  return openWs(f.market, `/ws/${f.stream.toLowerCase()}@kline_${tf}`, (d) => {
    const k = d.k;
    if (!k) return;
    cb(shift({ time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v }, basisOf(sym)));
  });
}

export interface Tick { price: number; change: number; open: number }
export const PAXG_ID = 'PAXG';

/** Barcha simvollar + PAXG (premium uchun) narxlari. Spot va futures alohida oqimda. */
export function subscribeTickers(cb: (id: string, t: Tick) => void): () => void {
  const groups: Record<Market, { feed: Feed; id: string }[]> = { spot: [], futures: [], mt5: [] };
  for (const s of SYMBOLS) groups[feedOf(s).market].push({ feed: feedOf(s), id: s.id });
  groups.spot.push({ feed: PAXG, id: PAXG_ID });
  const subs: (() => void)[] = [];
  for (const x of groups.mt5) {
    subs.push(
      poll(1000, async () => {
        const t = await mt5Get<Mt5Tick>('/tick');
        if (t && t.bid) {
          const o = t.dayOpen ?? t.bid;
          cb(x.id, { price: t.bid, open: o, change: ((t.bid - o) / o) * 100 });
        }
      }),
    );
  }
  if (demo) {
    const mt5Ids = new Set(groups.mt5.map((x) => x.id));
    subs.push(demoTickerStream((id, t) => { if (!mt5Ids.has(id)) cb(id, t); }));
    return () => subs.forEach((u) => u());
  }
  (['spot', 'futures'] as const).forEach((m) => {
    const g = groups[m];
    if (!g.length) return;
    const streams = [...new Set(g.map((x) => `${x.feed.stream.toLowerCase()}@miniTicker`))].join('/');
    subs.push(
      openWs(m, `/stream?streams=${streams}`, (msg) => {
        const d = msg.data;
        if (!d) return;
        for (const x of g) {
          if (x.feed.stream !== d.s) continue;
          const sym = SYMBOLS.find((q) => q.id === x.id);
          const b = sym ? basisOf(sym) : 0;
          const c = +d.c - b;
          const o = +d.o - b;
          cb(x.id, { price: c, open: o, change: ((c - o) / o) * 100 });
        }
      }),
    );
  });
  return () => subs.forEach((u) => u());
}

export interface Book { bid: number; ask: number }
/** Joriy simvol uchun eng yaxshi bid / ask (TradingView'dagi SOTISH / SOTIB OLISH kabi) */
export function subscribeBook(sym: SymbolInfo, cb: (b: Book) => void): () => void {
  const f = feedOf(sym);
  if (f.market === 'mt5') {
    return poll(500, async () => {
      const t = await mt5Get<Mt5Tick>('/tick');
      if (t && t.bid) cb({ bid: t.bid, ask: t.ask });
    });
  }
  if (demo) {
    const id = setInterval(() => {
      const p = demoPrice.get(sym.id) ?? sym.demoBase;
      const half = p * 0.00004;
      cb({ bid: p - half, ask: p + half });
    }, 1000);
    return () => clearInterval(id);
  }
  return openWs(f.market, `/ws/${f.stream.toLowerCase()}@bookTicker`, (d) => {
    const b = basisOf(sym);
    if (!d.b || !d.a) return;
    // kalibrlangan broker rejimida spredni telefondagi MT5 dagidek ko'rsatamiz
    const cal = priceMode === 'broker' && sym.spotCalibrate ? brokerCal : null;
    if (cal && cal.spread > 0) cb({ bid: +d.b - b, ask: +d.b - b + cal.spread });
    else cb({ bid: +d.b - b, ask: +d.a - b });
  });
}

export interface MarkInfo { mark: number; index: number; funding: number; nextFunding: number }
/** Futures: mark narx, indeks narx, funding stavkasi va keyingi funding vaqti (1 s) */
export function subscribeMark(sym: SymbolInfo, cb: (m: MarkInfo) => void): () => void {
  const f = feedOf(sym);
  if (demo || f.market !== 'futures') return () => {};
  return openWs('futures', `/ws/${f.stream.toLowerCase()}@markPrice@1s`, (d) => {
    if (d.p) cb({ mark: +d.p, index: +d.i, funding: +d.r, nextFunding: +d.T });
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
