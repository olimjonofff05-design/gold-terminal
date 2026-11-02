import type { Candle } from '../../../src/lib/types.ts';
import { getJson, log } from '../util.ts';

/**
 * Narx manbasi sayt bilan bir xil: Binance XAUUSDT perpetual.
 * GitHub Actions serverlari AQShda — Binance ularni bloklashi mumkin (HTTP 451). Unda zaxira:
 * Yahoo'dagi COMEX fyuchersi (GC=F) shamlari, spot oltinga (gold-api.com) moslab siljitilgan.
 * Sayt ham spot kalibrlash uchun aynan gold-api.com dan foydalanadi.
 */
export type Source = 'binance' | 'yahoo';
let source: Source | null = null;
let yahooBasis: number | null = null;
export const candleSource = () => (source === 'yahoo' ? 'Yahoo GC=F (spotga moslangan)' : 'Binance XAUUSDT');

const BINANCE = 'https://fapi.binance.com/fapi/v1/klines';
type Kline = (string | number)[];
const toCandle = (k: Kline): Candle => ({ time: Math.floor(Number(k[0]) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });

async function binance(tf: string, limit: number, startSec?: number): Promise<Candle[]> {
  const q = `symbol=XAUUSDT&interval=${tf}&limit=${Math.min(limit, 1500)}${startSec ? `&startTime=${startSec * 1000}` : ''}`;
  const j = await getJson<Kline[]>(`${BINANCE}?${q}`);
  return j.map(toCandle);
}

// Yahoo: 15m uchun 60 kun, 1h uchun 730 kun; 4h yo'q — 1h dan yig'iladi
const Y_TF: Record<string, { interval: string; range: string }> = {
  '15m': { interval: '15m', range: '30d' },
  '1h': { interval: '60m', range: '180d' },
  '4h': { interval: '60m', range: '360d' },
  '1d': { interval: '1d', range: '2y' },
};
interface YChart { chart: { result: { timestamp: number[]; indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] } }[] } }

async function spotGold(): Promise<number> {
  const j = await getJson<{ price: number }>('https://api.gold-api.com/price/XAU');
  return j.price;
}

async function yahoo(tf: string, limit: number): Promise<Candle[]> {
  const m = Y_TF[tf];
  if (!m) throw new Error(`Yahoo: ${tf} yo'q`);
  const j = await getJson<YChart>(`https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${m.interval}&range=${m.range}`);
  const r = j.chart.result[0];
  const q = r.indicators.quote[0];
  let c: Candle[] = [];
  r.timestamp.forEach((t, i) => {
    if (q.open[i] == null || q.close[i] == null) return;
    c.push({ time: t, open: q.open[i]!, high: q.high[i]!, low: q.low[i]!, close: q.close[i]!, volume: q.volume[i] ?? 0 });
  });
  if (tf === '4h') c = groupBy(c, 4 * 3600);
  if (yahooBasis === null) {
    try {
      yahooBasis = c[c.length - 1].close - (await spotGold());
    } catch {
      yahooBasis = 0;
    }
  }
  const b = yahooBasis;
  return c.slice(-limit).map((x) => ({ ...x, open: x.open - b, high: x.high - b, low: x.low - b, close: x.close - b }));
}

function groupBy(c: Candle[], step: number): Candle[] {
  const out: Candle[] = [];
  for (const x of c) {
    const t = Math.floor(x.time / step) * step;
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, x.high);
      last.low = Math.min(last.low, x.low);
      last.close = x.close;
      last.volume += x.volume;
    } else out.push({ ...x, time: t });
  }
  return out;
}

/** Oxirgi `limit` ta sham. Joriy (yopilmagan) sham ham kiradi — sayt ham shunday ko'rsatadi. */
export async function candles(tf: string, limit = 500): Promise<Candle[]> {
  if (source !== 'yahoo') {
    try {
      const c = await binance(tf, limit);
      source = 'binance';
      return c;
    } catch (e) {
      log('Binance ishlamadi, Yahoo ga o\'tamiz:', (e as Error).message);
      source = 'yahoo';
    }
  }
  return yahoo(tf, limit);
}

/** Berilgan vaqtdan boshlab shamlar (baholash va NFP tarixi uchun) */
export async function candlesFrom(tf: string, startSec: number, limit = 1500): Promise<Candle[]> {
  if (source !== 'yahoo') {
    try {
      return await binance(tf, limit, startSec);
    } catch {
      source = 'yahoo';
    }
  }
  return (await yahoo(tf, 5000)).filter((x) => x.time >= startSec).slice(0, limit);
}

export async function lastPrice(): Promise<number> {
  const c = await candles('15m', 2);
  return c[c.length - 1].close;
}
