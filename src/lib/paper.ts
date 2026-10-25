import { useCallback, useEffect, useRef, useState } from 'react';

export type Side = 'buy' | 'sell';
export interface Position {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  entry: number;
  sl?: number;
  tp?: number;
  openTime: number;
  note?: string;
}
export interface Pending extends Position {
  limit: number;
}
export interface Closed extends Position {
  exit: number;
  exitTime: number;
  pnl: number;
  reason: 'SL' | 'TP' | 'Qoʻlda';
}
export interface Account {
  start: number;
  balance: number;
  positions: Position[];
  pending: Pending[];
  history: Closed[];
}

const KEY = 'gold-terminal.paper.v1';
const fresh = (start = 10000): Account => ({ start, balance: start, positions: [], pending: [], history: [] });

function load(): Account {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return fresh();
}

export const pnlOf = (p: Position, price: number) => (price - p.entry) * p.qty * (p.side === 'buy' ? 1 : -1);
const uid = () => Math.random().toString(36).slice(2, 10);

export function usePaper(prices: Record<string, number>) {
  const [acc, setAcc] = useState<Account>(load);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>();

  const notify = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(acc));
    } catch {
      /* ignore */
    }
  }, [acc]);

  // engine: fill limits, trigger SL/TP on every price update
  useEffect(() => {
    setAcc((a) => {
      let changed = false;
      const msgs: string[] = [];
      const pending: Pending[] = [];
      const positions = [...a.positions];
      for (const o of a.pending) {
        const px = prices[o.symbol];
        if (px && ((o.side === 'buy' && px <= o.limit) || (o.side === 'sell' && px >= o.limit))) {
          positions.push({ ...o, entry: o.limit, openTime: Date.now() });
          msgs.push(`Limit order bajarildi: ${o.symbol} @ ${o.limit}`);
          changed = true;
        } else pending.push(o);
      }
      const keep: Position[] = [];
      const history = [...a.history];
      let balance = a.balance;
      for (const p of positions) {
        const px = prices[p.symbol];
        if (!px) { keep.push(p); continue; }
        const long = p.side === 'buy';
        const hitSl = p.sl !== undefined && (long ? px <= p.sl : px >= p.sl);
        const hitTp = p.tp !== undefined && (long ? px >= p.tp : px <= p.tp);
        if (hitSl || hitTp) {
          const exit = hitSl ? p.sl! : p.tp!;
          const pnl = pnlOf(p, exit);
          balance += pnl;
          history.unshift({ ...p, exit, exitTime: Date.now(), pnl, reason: hitSl ? 'SL' : 'TP' });
          msgs.push(`${p.symbol} ${hitSl ? 'Stop Loss' : 'Take Profit'}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} $`);
          changed = true;
        } else keep.push(p);
      }
      if (!changed) return a;
      if (msgs.length) setTimeout(() => notify(msgs.join(' · ')), 0);
      return { ...a, balance, pending, positions: keep, history };
    });
  }, [prices, notify]);

  const open = useCallback(
    (o: { symbol: string; side: Side; qty: number; price: number; sl?: number; tp?: number; limit?: number; note?: string }) => {
      const base = { id: uid(), symbol: o.symbol, side: o.side, qty: o.qty, sl: o.sl, tp: o.tp, openTime: Date.now(), note: o.note };
      setAcc((a) =>
        o.limit
          ? { ...a, pending: [...a.pending, { ...base, entry: o.limit, limit: o.limit }] }
          : { ...a, positions: [...a.positions, { ...base, entry: o.price }] },
      );
      notify(`${o.side === 'buy' ? 'BUY' : 'SELL'} ${o.qty} ${o.symbol} ${o.limit ? 'limit @ ' + o.limit : 'ochildi'}`);
    },
    [notify],
  );

  const close = useCallback(
    (id: string) => {
      setAcc((a) => {
        const p = a.positions.find((x) => x.id === id);
        const px = p && prices[p.symbol];
        if (!p || !px) return a;
        const pnl = pnlOf(p, px);
        return {
          ...a,
          balance: a.balance + pnl,
          positions: a.positions.filter((x) => x.id !== id),
          history: [{ ...p, exit: px, exitTime: Date.now(), pnl, reason: 'Qoʻlda' as const }, ...a.history],
        };
      });
    },
    [prices],
  );

  const cancel = useCallback((id: string) => setAcc((a) => ({ ...a, pending: a.pending.filter((x) => x.id !== id) })), []);
  const reset = useCallback((start = 10000) => setAcc(fresh(start)), []);

  return { acc, open, close, cancel, reset, toast };
}
