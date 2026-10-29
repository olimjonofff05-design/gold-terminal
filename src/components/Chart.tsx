import { useEffect, useRef } from 'react';
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Analysis, Candle, KillzoneSpan, Setup } from '../lib/types';
import type { Position } from '../lib/paper';

export interface Layers {
  fib: boolean;
  fvg: boolean;
  ob: boolean;
  liq: boolean;
  ms: boolean;
  ema: boolean;
  kz: boolean;
  mom: boolean;
}

export type Theme = 'light' | 'dark';

interface Props {
  dataKey: string;
  candles: Candle[];
  analysis: Analysis | null;
  digits: number;
  layers: Layers;
  positions: Position[];
  setup: Setup | null;
  theme: Theme;
  killzones: KillzoneSpan[];
}

const TZ = -new Date().getTimezoneOffset() * 60;
const T = (t: number) => (t + TZ) as UTCTimestamp;

interface Pal {
  up: string; down: string; gold: string; grid: string; text: string; border: string; cross: string; label: string;
  ema: [string, string, string]; fib: string; ext: string; ote: string;
  fvgB: string; fvgS: string; obB: string; obS: string; prem: string; disc: string;
  kz: Record<KillzoneSpan['kind'], string>; kzA: number; zoneA: number; font: string;
}
const PAL: Record<Theme, Pal> = {
  light: {
    up: '#0e9f6e', down: '#d64550', gold: '#b07d1c', grid: 'rgba(20,48,34,0.055)', text: '#5d6b62', border: 'rgba(20,48,34,0.12)',
    cross: 'rgba(176,125,28,0.55)', label: '#14382a',
    ema: ['rgba(37,99,235,0.75)', 'rgba(176,125,28,0.85)', 'rgba(124,77,189,0.75)'], fib: 'rgba(60,80,70,0.45)', ext: 'rgba(124,77,189,0.8)', ote: 'rgba(176,125,28,0.1)',
    fvgB: '14,159,110', fvgS: '214,69,80', obB: '37,99,235', obS: '217,119,6', prem: '214,69,80', disc: '14,159,110',
    kz: { asia: '124,77,189', london: '37,99,235', ny: '14,159,110' }, kzA: 0.055, zoneA: 0.11, font: '600 10px JetBrains Mono, monospace',
  },
  dark: {
    up: '#2fd39a', down: '#ff6b74', gold: '#e6b450', grid: 'rgba(255,255,255,0.045)', text: '#8fa39a', border: 'rgba(255,255,255,0.08)',
    cross: 'rgba(230,180,80,0.45)', label: '#1c3529',
    ema: ['rgba(106,168,255,0.75)', 'rgba(230,180,80,0.8)', 'rgba(192,132,252,0.75)'], fib: 'rgba(190,205,198,0.4)', ext: 'rgba(192,132,252,0.8)', ote: 'rgba(230,180,80,0.09)',
    fvgB: '47,211,154', fvgS: '255,107,116', obB: '96,165,250', obS: '251,146,60', prem: '255,107,116', disc: '47,211,154',
    kz: { asia: '167,139,250', london: '96,165,250', ny: '47,211,154' }, kzA: 0.05, zoneA: 0.12, font: '600 10px JetBrains Mono, monospace',
  },
};

const KZ_LABEL: Record<KillzoneSpan['kind'], string> = { asia: 'ASIA', london: 'LONDON KZ', ny: 'NY KZ' };

export default function Chart({ dataKey, candles, analysis, digits, layers, positions, setup, theme, killzones }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi>();
  const candleRef = useRef<ISeriesApi<'Candlestick'>>();
  const volRef = useRef<ISeriesApi<'Histogram'>>();
  const emaRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const linesRef = useRef<IPriceLine[]>([]);
  const prev = useRef<{ key: string; len: number; first: number }>({ key: '', len: 0, first: 0 });
  const drawState = useRef<{ analysis: Analysis | null; layers: Layers; P: Pal; kz: KillzoneSpan[]; step: number }>({ analysis, layers, P: PAL[theme], kz: killzones, step: 0 });
  const step = candles.length > 1 ? candles[candles.length - 1].time - candles[candles.length - 2].time : 0;
  drawState.current = { analysis, layers, P: PAL[theme], kz: killzones, step };
  const P = PAL[theme];

  // create chart once
  useEffect(() => {
    const el = wrapRef.current!;
    const chart = createChart(el, {
      layout: { background: { color: 'transparent' }, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.18 } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 12 },
      autoSize: true,
    });
    const cs = chart.addCandlestickSeries();
    const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    const mk = () => chart.addLineSeries({ lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    emaRefs.current = [mk(), mk(), mk()];
    chartRef.current = chart;
    candleRef.current = cs;
    volRef.current = vol;

    // overlay painter for zones / labels
    let raf = 0;
    const paint = () => {
      raf = requestAnimationFrame(paint);
      const cv = canvasRef.current;
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) {
        cv.width = w * dpr;
        cv.height = h * dpr;
        cv.style.width = w + 'px';
        cv.style.height = h + 'px';
      }
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { analysis: a, layers: L, P: Q, kz, step: st } = drawState.current;
      const ts = chart.timeScale();
      const right = ts.width();
      ctx.font = Q.font;
      // killzone fon soyalari
      if (L.kz && kz.length && st) {
        const half = Math.max(1, (ts.options().barSpacing || 6) / 2);
        for (const k of kz) {
          const x1 = ts.timeToCoordinate(T(k.from));
          const x2 = ts.timeToCoordinate(T(k.to));
          if (x1 === null || x2 === null || x2 < 0 || x1 > right) continue;
          const a1 = x1 - half;
          const w = x2 - x1 + half * 2;
          ctx.fillStyle = `rgba(${Q.kz[k.kind]},${Q.kzA})`;
          ctx.fillRect(a1, 0, w, h);
          if (w > 46) {
            ctx.fillStyle = `rgba(${Q.kz[k.kind]},0.7)`;
            ctx.fillText(KZ_LABEL[k.kind], a1 + 4, 14);
          }
        }
      }
      if (!a) return;
      const y = (p: number) => cs.priceToCoordinate(p);
      for (const z of a.zones) {
        if ((z.kind === 'FVG' && !L.fvg) || (z.kind === 'OB' && !L.ob)) continue;
        const x = ts.timeToCoordinate(T(z.time));
        const y1 = y(z.top);
        const y2 = y(z.bottom);
        if (x === null || y1 === null || y2 === null || x > right) continue;
        const x0 = Math.max(0, x);
        const bull = z.dir === 1;
        const col = z.kind === 'FVG' ? (bull ? Q.fvgB : Q.fvgS) : bull ? Q.obB : Q.obS;
        ctx.fillStyle = `rgba(${col},${z.kind === 'FVG' ? Q.zoneA * 0.8 : Q.zoneA})`;
        ctx.fillRect(x0, y1, right - x0, y2 - y1);
        ctx.strokeStyle = `rgba(${col},0.5)`;
        ctx.lineWidth = 1;
        ctx.setLineDash(z.kind === 'FVG' ? [3, 3] : []);
        ctx.strokeRect(x0 + 0.5, y1 + 0.5, right - x0, y2 - y1);
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(${col},0.95)`;
        ctx.fillText(`${bull ? '+' : '−'}${z.kind}`, Math.min(right - 40, x0 + 4), y1 + 11);
      }
      if (L.fib && a.fib) {
        const f = a.fib;
        const x = ts.timeToCoordinate(T(f.startTime));
        const x0 = x === null ? 0 : Math.max(0, x);
        const ote1 = f.levels.find((l) => l.r === 0.618)!.price;
        const ote2 = f.levels.find((l) => l.r === 0.786)!.price;
        const ya = y(ote1);
        const yb = y(ote2);
        if (ya !== null && yb !== null) {
          ctx.fillStyle = Q.ote;
          ctx.fillRect(x0, Math.min(ya, yb), right - x0, Math.abs(yb - ya));
        }
        const eq = y(f.levels.find((l) => l.r === 0.5)!.price);
        const top = y(f.high);
        const bot = y(f.low);
        if (eq !== null && top !== null && bot !== null) {
          ctx.fillStyle = `rgba(${Q.prem},0.035)`;
          ctx.fillRect(x0, top, right - x0, eq - top);
          ctx.fillStyle = `rgba(${Q.disc},0.035)`;
          ctx.fillRect(x0, eq, right - x0, bot - eq);
          ctx.fillStyle = `rgba(${Q.prem},0.7)`;
          ctx.fillText('PREMIUM', x0 + 4, top + 12);
          ctx.fillStyle = `rgba(${Q.disc},0.7)`;
          ctx.fillText('DISCOUNT', x0 + 4, bot - 5);
        }
      }
      if (L.ms) {
        for (const e of a.events.slice(-10)) {
          const x1 = ts.timeToCoordinate(T(e.fromTime));
          const x2 = ts.timeToCoordinate(T(e.time));
          const yy = y(e.price);
          if (x1 === null || x2 === null || yy === null) continue;
          const col = e.dir === 1 ? Q.up : Q.down;
          ctx.strokeStyle = col;
          ctx.globalAlpha = e.kind === 'CHoCH' ? 0.95 : 0.6;
          ctx.setLineDash(e.kind === 'CHoCH' ? [] : [4, 3]);
          ctx.beginPath();
          ctx.moveTo(x1, yy);
          ctx.lineTo(x2, yy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = col;
          ctx.fillText(e.kind, (x1 + x2) / 2 - 12, yy + (e.dir === 1 ? -4 : 11));
          ctx.globalAlpha = 1;
        }
      }
    };
    raf = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(raf);
      chart.remove();
    };
  }, []);

  // theme
  useEffect(() => {
    const chart = chartRef.current!;
    chart.applyOptions({
      layout: { textColor: P.text },
      grid: { vertLines: { color: P.grid }, horzLines: { color: P.grid } },
      crosshair: { vertLine: { color: P.cross, labelBackgroundColor: P.label }, horzLine: { color: P.cross, labelBackgroundColor: P.label } },
      rightPriceScale: { borderColor: P.border },
      timeScale: { borderColor: P.border },
    });
    candleRef.current!.applyOptions({ upColor: P.up, downColor: P.down, borderUpColor: P.up, borderDownColor: P.down, wickUpColor: P.up, wickDownColor: P.down });
    emaRefs.current.forEach((s, i) => s.applyOptions({ color: P.ema[i] }));
    prev.current = { ...prev.current, key: prev.current.key + '#' }; // hajm ranglarini qayta chizish
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // price format
  useEffect(() => {
    candleRef.current?.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove: 1 / 10 ** digits } });
  }, [digits]);

  // data
  useEffect(() => {
    const cs = candleRef.current!;
    const vol = volRef.current!;
    if (!candles.length) {
      cs.setData([]);
      vol.setData([]);
      prev.current = { key: dataKey, len: 0, first: 0 };
      return;
    }
    const p = prev.current;
    const toBar = (c: Candle) => ({ time: T(c.time), open: c.open, high: c.high, low: c.low, close: c.close });
    const toVol = (c: Candle) => ({ time: T(c.time), value: c.volume, color: (c.close >= c.open ? P.up : P.down) + '40' });
    const d = candles.length - p.len;
    if (p.key === dataKey && p.first === candles[0].time && (d === 0 || d === 1)) {
      for (const c of candles.slice(-1 - d)) {
        cs.update(toBar(c));
        vol.update(toVol(c));
      }
    } else {
      cs.setData(candles.map(toBar));
      vol.setData(candles.map(toVol));
      if (p.key.split('#')[0] !== dataKey) {
        const n = candles.length;
        chartRef.current!.timeScale().setVisibleLogicalRange({ from: n - 160, to: n + 10 });
      }
    }
    prev.current = { key: dataKey, len: candles.length, first: candles[0].time };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, dataKey, theme]);

  // analysis overlays: EMAs, markers, price lines
  useEffect(() => {
    const cs = candleRef.current!;
    const a = analysis;
    const emas = [a?.ema20, a?.ema50, a?.ema200];
    emaRefs.current.forEach((s, k) => {
      const arr = emas[k];
      s.applyOptions({ visible: layers.ema });
      s.setData(arr && layers.ema ? candles.map((c, i) => ({ time: T(c.time), value: arr[i] })).filter((x) => !isNaN(x.value)) : []);
    });
    const markers: SeriesMarker<Time>[] = [];
    if (a && layers.ms) {
      if (a.sweep)
        markers.push({
          time: T(a.sweep.time),
          position: a.sweep.dir === 1 ? 'belowBar' : 'aboveBar',
          color: P.gold,
          shape: a.sweep.dir === 1 ? 'arrowUp' : 'arrowDown',
          text: a.sweep.dir === 1 ? 'SSL sweep' : 'BSL sweep',
        });
    }
    if (a && layers.mom) {
      for (const m of a.momentum.events.slice(-40)) {
        markers.push({
          time: T(m.time),
          position: m.dir === 1 ? 'belowBar' : 'aboveBar',
          color: m.dir === 1 ? P.up : P.down,
          shape: m.dir === 1 ? 'arrowUp' : 'arrowDown',
          text: m.kind === 'Sweep' ? 'SW' : 'QT',
          size: 1.1,
        });
      }
    }
    markers.sort((x, y) => (x.time as number) - (y.time as number));
    cs.setMarkers(markers);

    linesRef.current.forEach((l) => cs.removePriceLine(l));
    linesRef.current = [];
    const add = (price: number, color: string, title: string, style = LineStyle.Dotted, width: 1 | 2 = 1, axis = true) => {
      if (!isFinite(price)) return;
      linesRef.current.push(cs.createPriceLine({ price, color, title, lineStyle: style, lineWidth: width, axisLabelVisible: axis }));
    };
    if (a?.fib && layers.fib) {
      for (const l of a.fib.levels) {
        const key = [0.618, 0.705].includes(l.r) ? P.gold : l.r < 0 ? P.ext : P.fib;
        add(l.price, key, `Fib ${l.label}`, l.r === 0.5 ? LineStyle.Dashed : LineStyle.Dotted, 1, false);
      }
    }
    if (a && layers.liq) {
      for (const l of a.liquidity) add(l.price, (l.kind.endsWith('H') || l.kind === 'BSL' ? P.down : P.up) + 'b3', l.kind, LineStyle.SparseDotted, 1, false);
      if (a.nyOpen !== null) add(a.nyOpen, P.gold, 'NY 00:00 Open', LineStyle.Dashed, 1, true);
    }
    for (const p of positions) {
      add(p.entry, p.side === 'buy' ? P.up : P.down, `${p.side.toUpperCase()} ${p.qty}`, LineStyle.Solid, 2);
      if (p.sl) add(p.sl, P.down, 'SL', LineStyle.Dashed, 1);
      if (p.tp) add(p.tp, P.up, 'TP', LineStyle.Dashed, 1);
    }
    if (setup && !positions.length) {
      add(setup.sl, P.down + '99', 'AI SL', LineStyle.LargeDashed);
      add(setup.tp1, P.up + '99', 'AI TP1', LineStyle.LargeDashed);
      if (setup.limitEntry) add(setup.limitEntry, P.gold, 'AI OTE kirish', LineStyle.LargeDashed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, layers, positions, setup, candles, theme]);

  return (
    <div className="chart-wrap">
      <div ref={wrapRef} className="chart-el" />
      <canvas ref={canvasRef} className="chart-overlay" />
    </div>
  );
}
