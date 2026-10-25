import type { Analysis, BacktestResult } from '../lib/types';
import { fmt } from '../lib/data';

interface Props {
  a: Analysis | null;
  digits: number;
  bt: (BacktestResult & { equity: number[] }) | null;
  btBusy: boolean;
  mtf: { tf: string; bias: number }[];
  onUseSetup: () => void;
}

function verdict(score: number) {
  if (score >= 60) return { t: 'KUCHLI BUY', c: 'up' };
  if (score >= 30) return { t: 'BUY', c: 'up' };
  if (score <= -60) return { t: 'KUCHLI SELL', c: 'down' };
  if (score <= -30) return { t: 'SELL', c: 'down' };
  return { t: 'KUTISH', c: 'flat' };
}

function Gauge({ score }: { score: number }) {
  const ang = (score / 100) * 90; // -90..90
  const r = 70;
  const arc = (from: number, to: number) => {
    const p = (d: number) => {
      const rad = ((d - 90) * Math.PI) / 180;
      return `${90 + r * Math.cos(rad)},${86 + r * Math.sin(rad)}`;
    };
    return `M${p(from)} A${r},${r} 0 0 1 ${p(to)}`;
  };
  return (
    <svg viewBox="0 0 180 100" className="gauge" aria-hidden>
      <path d={arc(-90, -27)} className="g-down" />
      <path d={arc(-27, 27)} className="g-flat" />
      <path d={arc(27, 90)} className="g-up" />
      <g style={{ transform: `rotate(${ang}deg)`, transformOrigin: '90px 86px', transition: 'transform .8s cubic-bezier(.2,.8,.2,1)' }}>
        <line x1="90" y1="86" x2="90" y2="26" className="g-needle" />
      </g>
      <circle cx="90" cy="86" r="5" className="g-hub" />
    </svg>
  );
}

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const w = 300;
  const h = 46;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * (h - 4) - 2}`).join(' ');
  const up = data[data.length - 1] >= 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="spark">
      <polyline points={pts} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function AnalysisPanel({ a, digits, bt, btBusy, mtf, onUseSetup }: Props) {
  if (!a) return <aside className="panel analysis"><div className="skeleton">Bozor tahlil qilinmoqda…</div></aside>;
  const v = verdict(a.score);
  const s = a.setup;
  const F = (x: number) => fmt(x, digits);
  return (
    <aside className="panel analysis">
      <section className="card hero-card">
        <div className="card-head">
          <span className="eyebrow">AI konfluens tahlili</span>
          <span className={`session ${a.session.killzone ? 'kz' : ''}`}>{a.session.killzone ? '● ' : ''}{a.session.name}</span>
        </div>
        <Gauge score={a.score} />
        <div className={`verdict ${v.c}`}>{v.t}</div>
        <div className="score-line">
          Konfluens bali <b className={v.c}>{a.score > 0 ? '+' : ''}{a.score}</b> / 100
        </div>
        <div className="mtf">
          {mtf.map((m) => (
            <div key={m.tf} className={`mtf-cell ${m.bias > 0 ? 'up' : m.bias < 0 ? 'down' : 'flat'}`}>
              <span>{m.tf}</span>
              <b>{m.bias > 0 ? '▲' : m.bias < 0 ? '▼' : '•'}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><span className="eyebrow">Savdo setapi</span>{s && <span className={`pill ${s.dir === 1 ? 'up' : 'down'}`}>{s.dir === 1 ? 'LONG' : 'SHORT'}</span>}</div>
        {s ? (
          <>
            <div className="levels">
              <div><span>Kirish (market)</span><b>{F(s.entry)}</b></div>
              {s.limitEntry && <div><span>OTE limit kirish</span><b className="gold">{F(s.limitEntry)}</b></div>}
              <div><span>Stop Loss</span><b className="down">{F(s.sl)}</b></div>
              <div><span>TP1 · likvidlik</span><b className="up">{F(s.tp1)} <small>{s.rr1.toFixed(1)}R</small></b></div>
              <div><span>TP2 · Fib 1.272</span><b className="up">{F(s.tp2)} <small>{s.rr2.toFixed(1)}R</small></b></div>
              <div><span>TP3 · Fib 1.618</span><b className="up">{F(s.tp3)}</b></div>
            </div>
            <button className="btn primary wide" onClick={onUseSetup}>Setapni buyurtmaga o'tkazish →</button>
          </>
        ) : (
          <p className="muted">Hozircha konfluens yetarli emas (|bal| &lt; 30). Eng yaxshi savdo — ba'zan savdo qilmaslik. Narx OTE yoki PD arrayga kelishini kuting.</p>
        )}
      </section>

      <section className="card">
        <div className="card-head"><span className="eyebrow">Konfluens omillari</span></div>
        <ul className="factors">
          {a.factors.map((f) => (
            <li key={f.key}>
              <div className="f-top"><span>{f.label}</span><small>{f.weight}%</small></div>
              <div className="f-bar"><i className={f.value >= 0 ? 'up' : 'down'} style={{ width: `${Math.abs(f.value) * 50}%`, [f.value >= 0 ? 'left' : 'right']: '50%' }} /></div>
              <div className="f-note">{f.note}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card-head"><span className="eyebrow">Tarixiy aniqlik · backtest</span>{btBusy && <span className="muted tiny">hisoblanmoqda…</span>}</div>
        {bt && bt.trades > 0 ? (
          <>
            <div className="stats4">
              <div><span>Win rate</span><b className={bt.winRate >= 0.5 ? 'up' : ''}>{(bt.winRate * 100).toFixed(0)}%</b></div>
              <div><span>Profit factor</span><b className={bt.profitFactor >= 1 ? 'up' : 'down'}>{isFinite(bt.profitFactor) ? bt.profitFactor.toFixed(2) : '∞'}</b></div>
              <div><span>Savdolar</span><b>{bt.trades}</b></div>
              <div><span>Jami</span><b className={bt.totalR >= 0 ? 'up' : 'down'}>{bt.totalR >= 0 ? '+' : ''}{bt.totalR.toFixed(1)}R</b></div>
            </div>
            <Spark data={bt.equity} />
            <p className="tiny muted">Yuklangan tarixda shu strategiya qoidalari bilan (SL yoki TP1) o'tkazilgan sinov. Maks. pasayish: {bt.maxDD.toFixed(1)}R. O'tmish natijasi kelajakni kafolatlamaydi.</p>
          </>
        ) : (
          <p className="muted">{btBusy ? 'Tarix boʻyicha sinov ketmoqda…' : 'Bu taymfreymda yetarli signal topilmadi.'}</p>
        )}
      </section>

      <section className="card">
        <div className="card-head"><span className="eyebrow">Asosiy darajalar</span></div>
        <div className="kv">
          {a.fib && (
            <>
              <div><span>Range high</span><b>{F(a.fib.high)}</b></div>
              <div><span>Equilibrium 0.5</span><b>{F(a.fib.levels.find((l) => l.r === 0.5)!.price)}</b></div>
              <div><span>Golden pocket 0.618</span><b className="gold">{F(a.fib.levels.find((l) => l.r === 0.618)!.price)}</b></div>
              <div><span>Range low</span><b>{F(a.fib.low)}</b></div>
            </>
          )}
          {a.liquidity.slice(0, 8).map((l, i) => (
            <div key={i}><span>{l.kind}</span><b className={l.kind === 'SSL' || l.kind === 'EQL' || l.kind === 'PDL' ? 'up' : 'down'}>{F(l.price)}</b></div>
          ))}
          <div><span>ATR 14</span><b>{F(a.atr)}</b></div>
          <div><span>RSI 14</span><b>{a.rsi.toFixed(1)}</b></div>
        </div>
      </section>
    </aside>
  );
}
