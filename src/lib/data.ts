import type { Candle } from './types';

export interface SymbolInfo {
  id: string;
  label: string;
  sub: string;
  stream: string; // Binance symbol
  digits: number;
  unit: string;
  demoBase: number;
}

export const SYMBOLS: SymbolInfo[] = [
  { id: 'XAUUSD', label: 'XAU/USD', sub: 'Oltin · PAXG', stream: 'PAXGUSDT', digits: 2, unit: 'oz', demoBase: 4100 },
  { id: 'BTCUSD', label: 'BTC/USD', sub: 'Bitcoin', stream: 'BTCUSDT', digits: 2, unit: 'BTC', demoBase: 112000 },
  { id: 'ETHUSD', label: 'ETH/USD', sub: 'Ethereum', stream: 'ETHUSDT', digits: 2, unit: 'ETH', demoBase: 4100 },
  { id: 'SOLUSD', label: 'SOL/USD', sub: 'Solana', stream: 'SOLUSDT', digits: 3, unit: 'SOL', demoBase: 195 },
  { id: 'BNBUSD', label: 'BNB/USD', sub: 'BNB', stream: 'BNBUSDT', digits: 2, unit: 'BNB', demoBase: 1050 },
  { id: 'XRPUSD', label: 'XRP/USD', sub: 'Ripple', stream: 'XRPUSDT', digits: 4, unit: 'XRP', demoBase: 2.45 },
];

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type TF = (typeof TIMEFRAMES)[number];
export const HTF: Record<TF, string> = { '1m': '15m', '5m': '1h', '15m': '4h', '1h': '4h', '4h': '1d', '1d': '1w' };
const TF_SEC: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };

const REST = ['https://api.binance.com', 'https://data-api.binance.vision'];
const WS = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];

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

const toCandle = (k: (string | number)[]): Candle => ({
  time: Math.floor(Number(k[0]) / 1000),
  open: +k[1],
  high: +k[2],
  low: +k[3],
  close: +k[4],
  volume: +k[5],
});

export async function fetchKlines(sym: SymbolInfo, tf: string, limit = 1000): Promise<Candle[]> {
  if (!demo) {
    for (const host of REST) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch(`${host}/api/v3/klines?symbol=${sym.stream}&interval=${tf}&limit=${limit}`, { signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) continue;
        const j = await r.json();
        if (Array.isArray(j) && j.length) return j.map(toCandle);
      } catch {
        /* try next host */
      }
    }
    setDemo(true);
  }
  return demoKlines(sym, tf, limit);
}

// ---------------- live streams ----------------
function openWs(path: string, onMsg: (d: any) => void): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let hostIdx = 0;
  let retry = 0;
  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket(`${WS[hostIdx % WS.length]}${path}`);
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
  return openWs(`/ws/${sym.stream.toLowerCase()}@kline_${tf}`, (d) => {
    const k = d.k;
    if (!k) return;
    cb({ time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
  });
}

export interface Tick { price: number; change: number }
export function subscribeTickers(cb: (id: string, t: Tick) => void): () => void {
  if (demo) return demoTickerStream(cb);
  const streams = SYMBOLS.map((s) => `${s.stream.toLowerCase()}@miniTicker`).join('/');
  return openWs(`/stream?streams=${streams}`, (m) => {
    const d = m.data;
    if (!d) return;
    const s = SYMBOLS.find((x) => x.stream === d.s);
    if (s) cb(s.id, { price: +d.c, change: ((+d.c - +d.o) / +d.o) * 100 });
  });
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
  const r = rng(sym.stream.length * 7919 + step);
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
  // keep every timeframe consistent with the shared demo price
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
      cb(s.id, { price: np, change: ((np - open.get(s.id)!) / open.get(s.id)!) * 100 });
    }
  }, 1000);
  return () => clearInterval(id);
}

export const fmt = (v: number, d: number) =>
  isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
