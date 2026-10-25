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
import type { Analysis, Candle, Setup } from '../lib/types';
import type { Position } from '../lib/paper';

export interface Layers {
  fib: boolean;
  fvg: boolean;
  ob: boolean;
  liq: boolean;
  ms: boolean;
  ema: boolean;
}

interface Props {
  dataKey: string;
  candles: Candle[];
  analysis: Analysis | null;
  digits: number;
  layers: Layers;
  positions: Position[];
  setup: Setup | null;
}

const TZ = -new Date().getTimezoneOffset() * 60;
const T = (t: number) => (t + TZ) as UTCTimestamp;

const C = {
  up: '#2ed3a0',
  down: '#ff5d6c',
  gold: '#e8b04b',
  grid: 'rgba(255,255,255,0.04)',
  text: '#8a93a6',
};

export default function Chart({ dataKey, candles, analysis, digits, layers, positions, setup }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi>();
  const candleRef = useRef<ISeriesApi<'Candlestick'>>();
  const volRef = useRef<ISeriesApi<'Histogram'>>();
  const emaRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const linesRef = useRef<IPriceLine[]>([]);
  const prev = useRef<{ key: string; len: number; first: number }>({ key: '', len: 0, first: 0 });
  const drawState = useRef<{ analysis: Analysis | null; layers: Layers }>({ analysis, layers });
  drawState.current = { analysis, layers };

  // create chart once
  useEffect(() => {
    const el = wrapRef.current!;
    const chart = createChart(el, {
      layout: { background: { color: 'transparent' }, textColor: C.text, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(232,176,75,0.4)', labelBackgroundColor: '#1b2230' }, horzLine: { color: 'rgba(232,176,75,0.4)', labelBackgroundColor: '#1b2230' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)', scaleMargins: { top: 0.08, bottom: 0.18 } },
      timeScale: { borderColor: 'rgba(255,255,255,0.06)', timeVisible: true, secondsVisible: false, rightOffset: 12 },
      autoSize: true,
    });
    const cs = chart.addCandlestickSeries({
      upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down,
    });
    const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    const mk = (color: string) => chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    emaRefs.current = [mk('rgba(120,170,255,0.7)'), mk('rgba(232,176,75,0.75)'), mk('rgba(200,120,255,0.7)')];
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
      const { analysis: a, layers: L } = drawState.current;
      if (!a) return;
      const ts = chart.timeScale();
      const right = ts.width();
      const y = (p: number) => cs.priceToCoordinate(p);
      ctx.font = '10px JetBrains Mono, monospace';
      for (const z of a.zones) {
        if ((z.kind === 'FVG' && !L.fvg) || (z.kind === 'OB' && !L.ob)) continue;
        const x = ts.timeToCoordinate(T(z.time));
        const y1 = y(z.top);
        const y2 = y(z.bottom);
        if (x === null || y1 === null || y2 === null || x > right) continue;
        const x0 = Math.max(0, x);
        const bull = z.dir === 1;
        const col = z.kind === 'FVG' ? (bull ? '46,211,160' : '255,93,108') : bull ? '90,160,255' : '255,150,70';
        ctx.fillStyle = `rgba(${col},${z.kind === 'FVG' ? 0.1 : 0.13})`;
        ctx.fillRect(x0, y1, right - x0, y2 - y1);
        ctx.strokeStyle = `rgba(${col},0.45)`;
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
          ctx.fillStyle = 'rgba(232,176,75,0.09)';
          ctx.fillRect(x0, Math.min(ya, yb), right - x0, Math.abs(yb - ya));
        }
        const eq = y(f.levels.find((l) => l.r === 0.5)!.price);
        const top = y(f.high);
        const bot = y(f.low);
        if (eq !== null && top !== null && bot !== null) {
          ctx.fillStyle = 'rgba(255,93,108,0.035)';
          ctx.fillRect(x0, top, right - x0, eq - top);
          ctx.fillStyle = 'rgba(46,211,160,0.035)';
          ctx.fillRect(x0, eq, right - x0, bot - eq);
          ctx.fillStyle = 'rgba(255,93,108,0.6)';
          ctx.fillText('PREMIUM', x0 + 4, top + 12);
          ctx.fillStyle = 'rgba(46,211,160,0.6)';
          ctx.fillText('DISCOUNT', x0 + 4, bot - 5);
        }
      }
      if (L.ms) {
        for (const e of a.events.slice(-10)) {
          const x1 = ts.timeToCoordinate(T(e.fromTime));
          const x2 = ts.timeToCoordinate(T(e.time));
          const yy = y(e.price);
          if (x1 === null || x2 === null || yy === null) continue;
          const col = e.dir === 1 ? C.up : C.down;
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
    const toVol = (c: Candle) => ({ time: T(c.time), value: c.volume, color: c.close >= c.open ? 'rgba(46,211,160,0.25)' : 'rgba(255,93,108,0.25)' });
    const d = candles.length - p.len;
    if (p.key === dataKey && p.first === candles[0].time && (d === 0 || d === 1)) {
      for (const c of candles.slice(-1 - d)) {
        cs.update(toBar(c));
        vol.update(toVol(c));
      }
    } else {
      cs.setData(candles.map(toBar));
      vol.setData(candles.map(toVol));
      if (p.key !== dataKey) {
        const n = candles.length;
        chartRef.current!.timeScale().setVisibleLogicalRange({ from: n - 160, to: n + 10 });
      }
    }
    prev.current = { key: dataKey, len: candles.length, first: candles[0].time };
  }, [candles, dataKey]);

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
          color: C.gold,
          shape: a.sweep.dir === 1 ? 'arrowUp' : 'arrowDown',
          text: a.sweep.dir === 1 ? 'SSL sweep' : 'BSL sweep',
        });
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
        const key = [0.618, 0.705].includes(l.r) ? C.gold : l.r < 0 ? 'rgba(200,120,255,0.8)' : 'rgba(180,190,210,0.45)';
        add(l.price, key, `Fib ${l.label}`, l.r === 0.5 ? LineStyle.Dashed : LineStyle.Dotted, 1, false);
      }
    }
    if (a && layers.liq) {
      for (const l of a.liquidity) add(l.price, l.kind.includes('H') || l.kind === 'BSL' ? 'rgba(255,93,108,0.7)' : 'rgba(46,211,160,0.7)', l.kind, LineStyle.SparseDotted, 1, false);
    }
    for (const p of positions) {
      add(p.entry, p.side === 'buy' ? C.up : C.down, `${p.side.toUpperCase()} ${p.qty}`, LineStyle.Solid, 2);
      if (p.sl) add(p.sl, C.down, 'SL', LineStyle.Dashed, 1);
      if (p.tp) add(p.tp, C.up, 'TP', LineStyle.Dashed, 1);
    }
    if (setup && !positions.length) {
      add(setup.sl, 'rgba(255,93,108,0.55)', 'AI SL', LineStyle.LargeDashed);
      add(setup.tp1, 'rgba(46,211,160,0.55)', 'AI TP1', LineStyle.LargeDashed);
      if (setup.limitEntry) add(setup.limitEntry, 'rgba(232,176,75,0.7)', 'AI OTE kirish', LineStyle.LargeDashed);
    }
  }, [analysis, layers, positions, setup, candles]);

  return (
    <div className="chart-wrap">
      <div ref={wrapRef} className="chart-el" />
      <canvas ref={canvasRef} className="chart-overlay" />
    </div>
  );
}
