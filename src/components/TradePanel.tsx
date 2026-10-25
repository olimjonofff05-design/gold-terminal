import { useEffect, useMemo, useState } from 'react';
import { fmt, SYMBOLS } from '../lib/data';
import { pnlOf, type Account, type Side } from '../lib/paper';
import type { Setup } from '../lib/types';

interface Props {
  symbol: string;
  price: number;
  digits: number;
  prices: Record<string, number>;
  paper: {
    acc: Account;
    open: (o: { symbol: string; side: Side; qty: number; price: number; sl?: number; tp?: number; limit?: number; note?: string }) => void;
    close: (id: string) => void;
    cancel: (id: string) => void;
    reset: (s?: number) => void;
  };
  prefill: { setup: Setup; n: number } | null;
}

type Tab = 'order' | 'pos' | 'hist' | 'stats';

export default function TradePanel({ symbol, price, digits, prices, paper, prefill }: Props) {
  const { acc } = paper;
  const [tab, setTab] = useState<Tab>('order');
  const [side, setSide] = useState<Side>('buy');
  const [type, setType] = useState<'market' | 'limit'>('market');
  const [limit, setLimit] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [risk, setRisk] = useState('1');
  const [qtyManual, setQtyManual] = useState('');

  useEffect(() => {
    if (!prefill) return;
    const s = prefill.setup;
    const r = (x: number) => x.toFixed(digits);
    setSide(s.dir === 1 ? 'buy' : 'sell');
    setSl(r(s.sl));
    setTp(r(s.tp1));
    if (s.limitEntry) {
      setType('limit');
      setLimit(r(s.limitEntry));
    } else setType('market');
    setQtyManual('');
    setTab('order');
  }, [prefill, digits]);

  const entry = type === 'limit' ? parseFloat(limit) : price;
  const slN = parseFloat(sl);
  const tpN = parseFloat(tp);
  const unrealized = acc.positions.reduce((s, p) => s + (prices[p.symbol] ? pnlOf(p, prices[p.symbol]) : 0), 0);
  const equity = acc.balance + unrealized;
  const riskUsd = (equity * (parseFloat(risk) || 0)) / 100;
  const autoQty = isFinite(slN) && isFinite(entry) && Math.abs(entry - slN) > 0 ? riskUsd / Math.abs(entry - slN) : NaN;
  const qty = qtyManual ? parseFloat(qtyManual) : autoQty;
  const slOk = !isFinite(slN) || (side === 'buy' ? slN < entry : slN > entry);
  const tpOk = !isFinite(tpN) || (side === 'buy' ? tpN > entry : tpN < entry);
  const rr = isFinite(slN) && isFinite(tpN) ? Math.abs(tpN - entry) / Math.abs(entry - slN) : NaN;
  const valid = isFinite(qty) && qty > 0 && isFinite(entry) && slOk && tpOk;
  const unit = SYMBOLS.find((s) => s.id === symbol)?.unit ?? '';
  const qd = qty >= 100 ? 1 : qty >= 1 ? 3 : 5;

  const submit = () => {
    if (!valid) return;
    paper.open({
      symbol, side, qty: +qty.toFixed(qd), price,
      sl: isFinite(slN) ? slN : undefined,
      tp: isFinite(tpN) ? tpN : undefined,
      limit: type === 'limit' ? entry : undefined,
    });
    setTab(type === 'limit' ? 'pos' : 'pos');
  };

  const stats = useMemo(() => {
    const h = acc.history;
    const wins = h.filter((x) => x.pnl > 0);
    const gp = wins.reduce((s, x) => s + x.pnl, 0);
    const gl = -h.filter((x) => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
    return {
      n: h.length,
      wr: h.length ? wins.length / h.length : 0,
      pf: gl ? gp / gl : gp ? Infinity : 0,
      best: h.reduce((m, x) => Math.max(m, x.pnl), 0),
      worst: h.reduce((m, x) => Math.min(m, x.pnl), 0),
      net: acc.balance - acc.start,
    };
  }, [acc]);

  const dg = (s: string) => SYMBOLS.find((x) => x.id === s)?.digits ?? 2;

  return (
    <section className="panel trade">
      <div className="acct">
        <div><span>Balans</span><b>${fmt(acc.balance, 2)}</b></div>
        <div><span>Equity</span><b>${fmt(equity, 2)}</b></div>
        <div><span>Ochiq P/L</span><b className={unrealized >= 0 ? 'up' : 'down'}>{unrealized >= 0 ? '+' : ''}{fmt(unrealized, 2)}</b></div>
        <div><span>Sof natija</span><b className={stats.net >= 0 ? 'up' : 'down'}>{stats.net >= 0 ? '+' : ''}{fmt(stats.net, 2)}</b></div>
        <span className="demo-tag">DEMO HISOB</span>
      </div>
      <nav className="tabs">
        {([
          ['order', 'Buyurtma'],
          ['pos', `Pozitsiyalar (${acc.positions.length + acc.pending.length})`],
          ['hist', `Tarix (${acc.history.length})`],
          ['stats', 'Statistika'],
        ] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>

      {tab === 'order' && (
        <div className="ticket">
          <div className="seg side">
            <button className={side === 'buy' ? 'buy on' : 'buy'} onClick={() => setSide('buy')}>BUY<small>{fmt(price, digits)}</small></button>
            <button className={side === 'sell' ? 'sell on' : 'sell'} onClick={() => setSide('sell')}>SELL<small>{fmt(price, digits)}</small></button>
          </div>
          <div className="grid-f">
            <label>Turi
              <div className="seg sm">
                <button className={type === 'market' ? 'on' : ''} onClick={() => setType('market')}>Market</button>
                <button className={type === 'limit' ? 'on' : ''} onClick={() => setType('limit')}>Limit</button>
              </div>
            </label>
            {type === 'limit' && <label>Limit narx<input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={price.toFixed(digits)} /></label>}
            <label className={slOk ? '' : 'bad'}>Stop Loss<input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="majburiy emas" /></label>
            <label className={tpOk ? '' : 'bad'}>Take Profit<input inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="majburiy emas" /></label>
            <label>Risk, % balans<input inputMode="decimal" value={risk} onChange={(e) => setRisk(e.target.value)} /></label>
            <label>Hajm ({unit})<input inputMode="decimal" value={qtyManual} onChange={(e) => setQtyManual(e.target.value)} placeholder={isFinite(autoQty) ? `avto: ${autoQty.toFixed(qd)}` : 'SL kiriting yoki qoʻlda'} /></label>
          </div>
          <div className="ticket-sum">
            <span>Risk: <b className="down">{isFinite(slN) && isFinite(qty) ? `$${fmt(Math.abs(entry - slN) * qty, 2)}` : '—'}</b></span>
            <span>Foyda: <b className="up">{isFinite(tpN) && isFinite(qty) ? `$${fmt(Math.abs(tpN - entry) * qty, 2)}` : '—'}</b></span>
            <span>R:R <b>{isFinite(rr) ? `1:${rr.toFixed(2)}` : '—'}</b></span>
            <span>Hajm: <b>{isFinite(qty) ? `${qty.toFixed(qd)} ${unit}` : '—'}</b></span>
          </div>
          <button className={`btn wide ${side === 'buy' ? 'buy' : 'sell'}`} disabled={!valid} onClick={submit}>
            {side === 'buy' ? 'BUY' : 'SELL'} {type === 'limit' ? 'LIMIT' : 'MARKET'} · {SYMBOLS.find((s) => s.id === symbol)?.label}
          </button>
        </div>
      )}

      {tab === 'pos' && (
        <div className="table-wrap">
          {acc.positions.length + acc.pending.length === 0 ? <p className="muted pad">Ochiq pozitsiya yo'q.</p> : (
            <table>
              <thead><tr><th>Juftlik</th><th>Tomon</th><th>Hajm</th><th>Kirish</th><th>Joriy</th><th>SL / TP</th><th>P/L</th><th /></tr></thead>
              <tbody>
                {acc.positions.map((p) => {
                  const px = prices[p.symbol];
                  const pl = px ? pnlOf(p, px) : 0;
                  return (
                    <tr key={p.id}>
                      <td>{SYMBOLS.find((s) => s.id === p.symbol)?.label}</td>
                      <td className={p.side === 'buy' ? 'up' : 'down'}>{p.side.toUpperCase()}</td>
                      <td>{p.qty}</td>
                      <td>{fmt(p.entry, dg(p.symbol))}</td>
                      <td>{px ? fmt(px, dg(p.symbol)) : '—'}</td>
                      <td className="muted">{p.sl ? fmt(p.sl, dg(p.symbol)) : '—'} / {p.tp ? fmt(p.tp, dg(p.symbol)) : '—'}</td>
                      <td className={pl >= 0 ? 'up' : 'down'}><b>{pl >= 0 ? '+' : ''}{fmt(pl, 2)}</b></td>
                      <td><button className="btn xs" onClick={() => paper.close(p.id)}>Yopish</button></td>
                    </tr>
                  );
                })}
                {acc.pending.map((p) => (
                  <tr key={p.id} className="pending">
                    <td>{SYMBOLS.find((s) => s.id === p.symbol)?.label}</td>
                    <td className={p.side === 'buy' ? 'up' : 'down'}>{p.side.toUpperCase()} LIMIT</td>
                    <td>{p.qty}</td>
                    <td>{fmt(p.limit, dg(p.symbol))}</td>
                    <td>{prices[p.symbol] ? fmt(prices[p.symbol], dg(p.symbol)) : '—'}</td>
                    <td className="muted">{p.sl ? fmt(p.sl, dg(p.symbol)) : '—'} / {p.tp ? fmt(p.tp, dg(p.symbol)) : '—'}</td>
                    <td className="muted">kutilmoqda</td>
                    <td><button className="btn xs" onClick={() => paper.cancel(p.id)}>Bekor</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'hist' && (
        <div className="table-wrap">
          {acc.history.length === 0 ? <p className="muted pad">Hali yopilgan savdo yo'q.</p> : (
            <table>
              <thead><tr><th>Vaqt</th><th>Juftlik</th><th>Tomon</th><th>Kirish</th><th>Chiqish</th><th>Sabab</th><th>P/L</th></tr></thead>
              <tbody>
                {acc.history.slice(0, 100).map((h) => (
                  <tr key={h.id + h.exitTime}>
                    <td className="muted">{new Date(h.exitTime).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{SYMBOLS.find((s) => s.id === h.symbol)?.label}</td>
                    <td className={h.side === 'buy' ? 'up' : 'down'}>{h.side.toUpperCase()}</td>
                    <td>{fmt(h.entry, dg(h.symbol))}</td>
                    <td>{fmt(h.exit, dg(h.symbol))}</td>
                    <td>{h.reason}</td>
                    <td className={h.pnl >= 0 ? 'up' : 'down'}><b>{h.pnl >= 0 ? '+' : ''}{fmt(h.pnl, 2)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'stats' && (
        <div className="stats-tab">
          <div className="stats4">
            <div><span>Savdolar</span><b>{stats.n}</b></div>
            <div><span>Win rate</span><b>{(stats.wr * 100).toFixed(0)}%</b></div>
            <div><span>Profit factor</span><b>{isFinite(stats.pf) ? stats.pf.toFixed(2) : '∞'}</b></div>
            <div><span>Eng yaxshi / yomon</span><b><span className="up">+{fmt(stats.best, 0)}</span> / <span className="down">{fmt(stats.worst, 0)}</span></b></div>
          </div>
          <div className="reset-row">
            <span className="muted">Demo hisobni qayta boshlash:</span>
            {[1000, 10000, 100000].map((v) => (
              <button key={v} className="btn xs" onClick={() => confirmReset(v, paper.reset)}>${v.toLocaleString('en-US')}</button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function confirmReset(v: number, reset: (s?: number) => void) {
  // inline confirmation without blocking dialogs
  const el = document.activeElement as HTMLButtonElement | null;
  if (el && el.dataset.armed !== '1') {
    el.dataset.armed = '1';
    const t = el.textContent;
    el.textContent = 'Tasdiqlash?';
    setTimeout(() => {
      el.dataset.armed = '';
      el.textContent = t;
    }, 2500);
    return;
  }
  if (el) el.dataset.armed = '';
  reset(v);
}
