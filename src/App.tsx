import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart, { type Layers, type Theme } from './components/Chart';
import AnalysisPanel from './components/AnalysisPanel';
import TradePanel from './components/TradePanel';
import { analyze, evalMoves, killzoneSpans, trendOf } from './lib/analysis';
import {
  feedOf, fetchKlines, fmt, getBridge, getBrokerCal, setBrokerCal, startBridgeProbe, getSpotRef, isCalibrated, onSpotRef, setPriceMode, startSpotRef, subscribeMark, type MarkInfo, type PriceMode, goldMarket, HTF, isDemo, onDemoChange, onSourceChange, subscribeBook, subscribeKline, subscribeTickers,
  SYMBOLS, TF_SEC, TIMEFRAMES, usingFallback, type Book, type TF, type Tick,
} from './lib/data';
import { usePaper } from './lib/paper';
import type { Analysis, BacktestResult, Candle, MoveSignal, Setup } from './lib/types';

const LS = 'gold-terminal.ui.v2';
const nextFundingIn = (t: number) => {
  const m = Math.max(0, Math.round((t - Date.now()) / 60000));
  return `${Math.floor(m / 60)}s ${m % 60}d`;
};
const loadUi = () => {
  try {
    return JSON.parse(localStorage.getItem(LS) || '{}');
  } catch {
    return {};
  }
};

const LAYER_LABELS: [keyof Layers, string][] = [
  ['fib', 'Fibonacci'],
  ['fvg', 'FVG'],
  ['ob', 'Order Block'],
  ['liq', 'Likvidlik'],
  ['ms', 'BOS/CHoCH'],
  ['ema', 'EMA'],
  ['kz', 'Killzone'],
  ['mom', 'Harakat signali'],
];

const DEFAULT_LAYERS: Layers = { fib: true, fvg: true, ob: true, liq: true, ms: true, ema: true, kz: true, mom: true };

const BRIDGE_DOC = 'https://github.com/olimjonofff05-design/gold-terminal/tree/main/mt5-bridge#readme';

/** Ko'priksiz broker kalibrlash: telefondagi MT5 narxini kiritish */
function BrokerCalBox({ digits, displayed, cal }: { digits: number; displayed: number; cal: ReturnType<typeof getBrokerCal> }) {
  const [bid, setBid] = useState('');
  const [ask, setAsk] = useState('');
  const b = parseFloat(bid.replace(',', '.'));
  const a = parseFloat(ask.replace(',', '.'));
  const ok = isFinite(b) && b > 0 && (!ask || (isFinite(a) && a >= b && a - b < 5));
  const apply = () => {
    if (!ok) return;
    // ko'rsatilgan = xom − spotBasis + offset  ⇒  yangi offset = MT5 bid − (ko'rsatilgan − joriy offset)
    const base = displayed - (cal?.offset ?? 0);
    setBrokerCal({ offset: b - base, spread: isFinite(a) ? a - b : cal?.spread ?? 0, at: Date.now() });
    setBid('');
    setAsk('');
  };
  const ago = cal ? Math.round((Date.now() - cal.at) / 60000) : 0;
  return (
    <div className="calbox">
      <div className="calbox-t">
        <b>MT5 ko'prigi ishlamayapti.</b> Aniq narx uchun kompyuterda <a href={BRIDGE_DOC} target="_blank" rel="noreferrer">MT5 ko'prigini</a> ishga tushiring.
        Hozircha telefondagi MT5 narxini kiritib, grafikni moslashtiring:
      </div>
      <div className="calbox-f">
        <label>SELL (Bid)<input inputMode="decimal" value={bid} onChange={(e) => setBid(e.target.value)} placeholder={displayed ? displayed.toFixed(digits) : ''} /></label>
        <label>BUY (Ask)<input inputMode="decimal" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="ixtiyoriy" /></label>
        <button className="btn xs primary" disabled={!ok} onClick={apply}>Moslash</button>
        {cal && (
          <span className="muted tiny">
            Farq {cal.offset >= 0 ? '+' : ''}{cal.offset.toFixed(2)}, spred {cal.spread.toFixed(2)} · {ago < 1 ? 'hozirgina' : `${ago} daq. oldin`}
            {' '}<button className="linkbtn" onClick={() => setBrokerCal(null)}>tozalash</button>
          </span>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const ui = useMemo(loadUi, []);
  const [symId, setSymId] = useState<string>(ui.symId ?? 'XAUUSD');
  const [tf, setTf] = useState<TF>(ui.tf ?? '15m');
  const [layers, setLayers] = useState<Layers>({ ...DEFAULT_LAYERS, ...(ui.layers ?? {}) });
  const [theme, setTheme] = useState<Theme>(ui.theme ?? 'light');
  const [book, setBook] = useState<Book | null>(null);
  const [mode, setModeState] = useState<PriceMode>(() => {
    const m: PriceMode = ui.mode === 'spot' || ui.mode === 'broker' ? ui.mode : 'futures';
    setPriceMode(m);
    return m;
  });
  const setMode = (m: PriceMode) => {
    setPriceMode(m);
    setModeState(m);
  };
  const [mark, setMark] = useState<MarkInfo | null>(null);
  const [srcRev, setSrcRev] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [alerts, setAlerts] = useState<boolean>(!!ui.alerts);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [htfBias, setHtfBias] = useState<0 | 1 | -1>(0);
  const [mtf, setMtf] = useState<{ tf: string; bias: number }[]>([]);
  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  const [bt, setBt] = useState<(BacktestResult & { equity: number[] }) | null>(null);
  const [btBusy, setBtBusy] = useState(false);
  const [demo, setDemo] = useState(isDemo());
  const [prefill, setPrefill] = useState<{ setup: Setup; n: number } | null>(null);
  const [view, setView] = useState<'chart' | 'ai' | 'trade'>('chart');

  const sym = SYMBOLS.find((s) => s.id === symId) ?? SYMBOLS[0];
  const dataKey = `${sym.id}-${tf}`;
  // manba yoki kalibrlash o'zgarsa tarixni qayta yuklash uchun
  const feedKey = `${feedOf(sym).market}:${feedOf(sym).stream}:${getBrokerCal()?.offset ?? 0}`; // srcRev o'zgarganda qayta hisoblanadi

  useEffect(() => onDemoChange(setDemo) as () => void, []);
  useEffect(() => onSourceChange(() => setSrcRev((x) => x + 1)) as () => void, []);
  const [, setSpotRev] = useState(0);
  useEffect(() => onSpotRef(() => setSpotRev((x) => x + 1)) as () => void, []);
  useEffect(() => { startSpotRef(); }, []);
  useEffect(() => { startBridgeProbe(); }, [mode]);
  useEffect(() => {
    setMark(null);
    return subscribeMark(sym, setMark);
  }, [sym, demo, srcRev]);
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f1e8' : '#0a1511');
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify({ symId, tf, layers, alerts, theme, mode }));
    } catch {
      /* ignore */
    }
  }, [symId, tf, layers, alerts, theme, mode]);

  // tickers (all symbols + PAXG for premium); resubscribe when a source falls back
  useEffect(() => subscribeTickers((id, t) => setTicks((p) => ({ ...p, [id]: t }))), [demo, srcRev, mode]);

  // best bid / ask for current symbol
  useEffect(() => {
    setBook(null);
    return subscribeBook(sym, setBook);
  }, [sym, demo, srcRev]);

  // history + live candles
  useEffect(() => {
    let dead = false;
    let unsub = () => {};
    setLoading(true);
    setCandles([]);
    setAnalysis(null);
    setBt(null);
    fetchKlines(sym, tf, 1000).then((cs) => {
      if (dead) return;
      setCandles(cs);
      setLoading(false);
      unsub = subscribeKline(sym, tf, (c) => {
        setCandles((prev) => {
          if (!prev.length) return prev;
          const last = prev[prev.length - 1];
          if (c.time === last.time) return [...prev.slice(0, -1), c];
          if (c.time > last.time) return [...prev.slice(prev.length >= 1000 ? 1 : 0), c];
          return prev;
        });
      });
    });
    return () => {
      dead = true;
      unsub();
    };
  }, [sym, tf, demo, mode, feedKey]);

  // higher-timeframe bias + multi-timeframe matrix
  useEffect(() => {
    let dead = false;
    const run = async () => {
      const htf = await fetchKlines(sym, HTF[tf], 400);
      if (!dead) setHtfBias(trendOf(htf));
      const rows: { tf: string; bias: number }[] = [];
      for (const t of ['15m', '1h', '4h', '1d']) {
        const c = await fetchKlines(sym, t, 400);
        rows.push({ tf: t, bias: trendOf(c) });
      }
      if (!dead) setMtf(rows);
    };
    run();
    const id = setInterval(run, 5 * 60 * 1000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [sym, tf, demo, mode, feedKey]);

  // throttled analysis
  const lastRun = useRef(0);
  const pendingRun = useRef<number>();
  useEffect(() => {
    if (!candles.length) return;
    const go = () => {
      lastRun.current = Date.now();
      setAnalysis(analyze(candles, { htfBias }));
    };
    const wait = 1200 - (Date.now() - lastRun.current);
    window.clearTimeout(pendingRun.current);
    if (wait <= 0) go();
    else pendingRun.current = window.setTimeout(go, wait);
  }, [candles, htfBias]);

  // backtest in a worker whenever a new bar closes
  const workerRef = useRef<Worker>();
  const btId = useRef(0);
  const barCount = candles.length ? `${candles[0].time}-${candles.length}` : '';
  useEffect(() => {
    if (!barCount) return;
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./lib/backtest.worker.ts', import.meta.url), { type: 'module' });
    }
    const w = workerRef.current;
    const id = ++btId.current;
    setBtBusy(true);
    w.onmessage = (e) => {
      if (e.data.id !== btId.current) return;
      setBt(e.data.result);
      setBtBusy(false);
    };
    w.postMessage({ id, candles: candles.slice(0, -1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barCount]);

  // prices for paper engine (ticker + live chart price for current symbol)
  const livePrice = candles.length ? candles[candles.length - 1].close : ticks[sym.id]?.price ?? 0;
  const prices = useMemo(() => {
    const p: Record<string, number> = {};
    for (const [k, v] of Object.entries(ticks)) p[k] = v.price;
    if (livePrice) p[sym.id] = livePrice;
    return p;
  }, [ticks, livePrice, sym.id]);
  const paper = usePaper(prices);

  // signal alerts
  const lastSignal = useRef<string>('');
  useEffect(() => {
    const s = analysis?.setup;
    const sig = s ? `${dataKey}:${s.dir}` : '';
    if (sig && sig !== lastSignal.current && alerts && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`${sym.label} ${tf}: ${s!.dir === 1 ? 'BUY' : 'SELL'} signal`, {
        body: `Konfluens ${analysis!.score}. Kirish ${fmt(s!.entry, sym.digits)}, SL ${fmt(s!.sl, sym.digits)}, TP ${fmt(s!.tp1, sym.digits)}`,
      });
    }
    lastSignal.current = sig;
  }, [analysis, alerts, dataKey, sym, tf]);

  // harakat signali bildirishnomasi
  const lastMove = useRef('');
  useEffect(() => {
    const m = analysis?.momentum.current;
    const key = m ? `${dataKey}:${m.time}:${m.kind}` : '';
    if (key && key !== lastMove.current && lastMove.current !== '' && alerts && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`⚡ ${sym.label} ${tf}: ${m!.kind} ${m!.dir === 1 ? 'LONG' : 'SHORT'}`, {
        body: `${m!.note}. Kirish ${fmt(m!.price, sym.digits)}, SL ${fmt(m!.sl, sym.digits)}, TP ${fmt(m!.tp, sym.digits)}`,
      });
    }
    if (key || lastMove.current === '') lastMove.current = key || '-';
  }, [analysis, alerts, dataKey, sym, tf]);
  const moveStats = useMemo(() => (analysis ? evalMoves(candles, analysis.momentum.events) : null), [analysis, candles]);
  const applyMove = useCallback((m: MoveSignal) => {
    const risk = Math.abs(m.price - m.sl);
    setPrefill({ setup: { dir: m.dir, entry: m.price, limitEntry: null, sl: m.sl, tp1: m.tp, tp2: m.tp + m.dir * risk, tp3: m.tp + m.dir * 2 * risk, rr1: m.rr, rr2: m.rr + 1 }, n: Date.now() });
    setView('trade');
  }, []);

  const toggleAlerts = useCallback(async () => {
    if (!alerts && 'Notification' in window && Notification.permission !== 'granted') {
      const r = await Notification.requestPermission();
      if (r !== 'granted') return;
    }
    setAlerts(!alerts);
  }, [alerts]);

  const symPositions = paper.acc.positions.filter((p) => p.symbol === sym.id);
  const chg = ticks[sym.id]?.change ?? 0;
  const prevClose = candles.length > 1 ? candles[candles.length - 2].close : livePrice;
  const killzones = useMemo(() => killzoneSpans(candles, TF_SEC[tf]), [candles, tf]);
  const feed = feedOf(sym);
  const fallback = usingFallback(sym);
  const mkt = sym.metal ? goldMarket(clock / 1000) : null;
  const spotRef = getSpotRef();
  const bridge = getBridge();
  const brokerCal = getBrokerCal();
  const calibrated = isCalibrated(sym);

  return (
    <div className={`app view-${view}`}>
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" className="logo" aria-hidden>
            <defs>
              <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f6d77f" /><stop offset="1" stopColor="#a8761a" /></linearGradient>
            </defs>
            <path d="M16 2 30 16 16 30 2 16Z" fill="url(#lg)" />
            <path d="M16 8 24 16 16 24 8 16Z" fill="var(--logo-hole)" />
            <path d="M16 12.5 19.5 16 16 19.5 12.5 16Z" fill="url(#lg)" />
          </svg>
          <div>
            <b>AURUM</b><span>Gold · ICT terminal</span>
          </div>
        </div>
        <div className="tape">
          {SYMBOLS.map((s) => {
            const t = ticks[s.id];
            return (
              <button key={s.id} className={`tape-i ${s.id === sym.id ? 'on' : ''}`} onClick={() => setSymId(s.id)}>
                <span>{s.label}</span>
                <b>{t ? fmt(t.price, s.digits) : '…'}</b>
                <i className={t && t.change >= 0 ? 'up' : 'down'}>{t ? `${t.change >= 0 ? '+' : ''}${t.change.toFixed(2)}%` : ''}</i>
              </button>
            );
          })}
        </div>
        <div className="top-r">
          {feed.market === 'mt5' ? (
            <span className="live" title={`${bridge?.broker ?? ''} · ${bridge?.server ?? ''}`}><i />MT5 LIVE</span>
          ) : (
            <span className={`live ${demo ? 'demo' : fallback ? 'warn' : ''}`} title={demo ? 'Birja API ochilmadi — sintetik maʼlumot' : feed.name}><i />{demo ? 'DEMO MAʼLUMOT' : fallback ? 'TAXMINIY' : 'LIVE'}</span>
          )}
          <button className="btn xs icon" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title="Mavzuni almashtirish" aria-label="Mavzuni almashtirish">
            {theme === 'light' ? '☾' : '☀'}
          </button>
          <button className={`btn xs ${alerts ? 'on' : ''}`} onClick={toggleAlerts} title="Signal paydo bo'lganda brauzer bildirishnomasi">
            {alerts ? '🔔 Signal ON' : '🔕 Signal OFF'}
          </button>
        </div>
      </header>

      <main className="main">
        <section className="center">
          <div className="chart-head">
            <div className="sym">
              <h1>{sym.label}</h1>
              <span className="sub">{sym.sub}</span>
              <span className={`px ${livePrice >= prevClose ? 'up' : 'down'}`}>{fmt(livePrice, sym.digits)}</span>
              <span className={`chg ${chg >= 0 ? 'up' : 'down'}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}% 24s</span>
              {mkt && <span className={`mkt ${mkt.open ? 'open' : 'closed'}`}><i />{mkt.label}</span>}
            </div>
            {book && (
              <div className="quote">
                <div className="q sell"><span>SOTISH</span><b>{fmt(book.bid, sym.digits)}</b></div>
                <div className="spread">{fmt(book.ask - book.bid, sym.digits)}</div>
                <div className="q buy"><span>SOTIB OLISH</span><b>{fmt(book.ask, sym.digits)}</b></div>
              </div>
            )}
            <div className="tfs">
              {TIMEFRAMES.map((t) => (
                <button key={t} className={t === tf ? 'on' : ''} onClick={() => setTf(t)}>{t}</button>
              ))}
            </div>
          </div>
          <div className="layers">
            {LAYER_LABELS.map(([k, l]) => (
              <button key={k} className={layers[k] ? 'on' : ''} onClick={() => setLayers({ ...layers, [k]: !layers[k] })}>{l}</button>
            ))}
            {analysis && (
              <span className={`mini-verdict ${analysis.score >= 30 ? 'up' : analysis.score <= -30 ? 'down' : 'flat'}`}>
                AI: {analysis.score >= 30 ? 'BUY' : analysis.score <= -30 ? 'SELL' : 'KUTISH'} · {analysis.score > 0 ? '+' : ''}{analysis.score}
              </span>
            )}
          </div>
          <div className="src-line">
            {sym.spotCalibrate && (
              <div className="seg-mini" role="group" aria-label="Narx rejimi">
                <button className={mode === 'futures' ? 'on' : ''} onClick={() => setMode('futures')} title="Binance XAUUSDT perpetual narxi — Binance fyuchersda savdo qilish uchun">Fyuchers</button>
                <button className={mode === 'spot' ? 'on' : ''} onClick={() => setMode('spot')} title="Spot oltin — OANDA / TradingView XAUUSD ga mos">Spot</button>
                <button className={mode === 'broker' ? 'on' : ''} onClick={() => setMode('broker')} title="MT5 brokeringiz (Exness) narxi — telefoningizdagi MT5 bilan bir xil">Broker · MT5</button>
              </div>
            )}
            <span>Manba: <b>{demo && !bridge ? 'demo (oflayn)' : feed.market === 'mt5' && bridge ? `MT5 · ${bridge.broker || 'broker'} · ${bridge.symbol}` : feed.name}{!demo && feed.market === 'futures' ? ' perp' : ''}</b>
              {feed.market === 'mt5' ? <b className="up"> · aniq broker narxi</b> : mode === 'broker' && brokerCal ? ' · brokerga kalibrlangan' : calibrated ? ' · spotga moslangan' : ''}
            </span>
            {mark && (
              <>
                <span>Mark: <b>{fmt(mark.mark - (calibrated && spotRef ? spotRef.basis : 0), sym.digits)}</b></span>
                <span title={`Keyingi funding ${nextFundingIn(mark.nextFunding)} dan keyin`}>Funding: <b className={mark.funding >= 0 ? 'up' : 'down'}>{(mark.funding * 100).toFixed(4)}%</b> <small>({nextFundingIn(mark.nextFunding)})</small></span>
              </>
            )}
            {sym.spotCalibrate && spotRef && !demo && (
              <span title="Fyuchers (XAUUSDT) va spot oltin (OANDA/TradingView) orasidagi farq">
                Spot: <b>{fmt(spotRef.spot, 2)}</b> · fyuchers farqi <b className="gold">{spotRef.basis >= 0 ? '+' : ''}{fmt(spotRef.basis, 2)}</b>{!spotRef.ok && ' (eski)'}
              </span>
            )}
            {fallback && <span className="warn-t">Futures API ochilmadi — PAXG koʻrsatilmoqda</span>}
          </div>
          {sym.spotCalibrate && mode === 'broker' && feed.market !== 'mt5' && (
            <BrokerCalBox digits={sym.digits} displayed={livePrice} cal={brokerCal} />
          )}
          <div className="chart-box">
            <Chart dataKey={dataKey} candles={candles} analysis={analysis} digits={sym.digits} layers={layers} positions={symPositions} setup={analysis?.setup ?? null} theme={theme} killzones={killzones} />
            {loading && <div className="loading"><div className="spinner" />Bozor ma'lumotlari yuklanmoqda…</div>}
          </div>
          <TradePanel symbol={sym.id} price={livePrice} digits={sym.digits} prices={prices} paper={paper} prefill={prefill} />
        </section>
        <AnalysisPanel
          a={analysis}
          digits={sym.digits}
          bt={bt}
          btBusy={btBusy}
          mtf={mtf}
          moveStats={moveStats}
          livePrice={livePrice}
          onUseMove={applyMove}
          onUseSetup={() => {
            if (analysis?.setup) setPrefill({ setup: analysis.setup, n: Date.now() });
            setView('trade');
          }}
        />
      </main>

      <nav className="mobile-nav">
        <button className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>Grafik</button>
        <button className={view === 'ai' ? 'on' : ''} onClick={() => setView('ai')}>AI tahlil</button>
        <button className={view === 'trade' ? 'on' : ''} onClick={() => setView('trade')}>Savdo</button>
      </nav>

      <footer className="foot">
        XAU/USD grafigi standart holatda Binance XAUUSDT perpetual (fyuchers) narxini koʻrsatadi. "Spot narxi" rejimida grafik spot oltinga (gold-api.com, OANDA/TradingView bilan bir xil) suriladi.
        Spot bozor dam olish kunlari yopiq, XAUUSDT esa 24/7 savdolanadi. Vaqtlar NY vaqti boʻyicha killzonalarga moslangan.
        Tahlil — ehtimollik vositasi, moliyaviy maslahat emas. Savdolar faqat demo hisobda.
      </footer>

      {paper.toast && <div className="toast">{paper.toast}</div>}
    </div>
  );
}
