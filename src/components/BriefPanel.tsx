import { useEffect, useState } from 'react';
import './BriefPanel.css';

/**
 * Telegram bot (bot/) har kuni yozadigan brif. Bot natijani repodagi `bot-data` branchiga
 * `latest.json` qilib saqlaydi, sayt uni shu yerdan o'qiydi. Ma'lumot kelmasa — panel
 * buni aytadi, saytning qolgan qismi bunga bog'liq emas.
 * Tiplar bot/src/brief/build.ts dagi Brief bilan mos (bu yerda faqat sayt ishlatadigan maydonlar).
 */
const BRIEF_URL =
  import.meta.env.VITE_BRIEF_URL || 'https://raw.githubusercontent.com/olimjonofff05-design/gold-terminal/bot-data/latest.json';

type Dir = 1 | -1;
interface Zone { lo: number; hi: number; score: number; strength: string; tags: string[]; side: Dir }
interface Plan { dir: Dir; main: boolean; kind: 'qaytish' | 'buzilish'; zone: Zone; entry: number; sl: number; tp1: number; tp2: number; tp1Tag: string; tp2Tag: string; rr1: number; rr2: number }
interface Brief {
  date: string;
  at: number;
  source: string;
  price: number;
  bias: 'LONG' | 'SHORT' | 'NEYTRAL';
  prob: number;
  narrative?: string;
  notes: string[];
  factors: { key: string; label: string; value: number; weight: number; note: string }[];
  zones: Zone[];
  plans: Plan[];
  invalid: { price: number; text: string } | null;
}
interface Evaluation { date: string; bias: Brief['bias']; biasOk: boolean; plans: { dir: Dir; result: string; r: number }[] }
interface Latest {
  updatedAt: number;
  brief: Brief;
  prevEval: Evaluation | null;
  stats: { days: number; biasOk: number; biasAcc: number; trades: number; wins: number; totalR: number };
  upcoming: { title: string; time: number; forecast: string; previous: string }[];
}

type Tab = 'brief' | 'cal' | 'stats' | 'lot';
const BIAS_UZ = { LONG: 'LONG', SHORT: 'SHORT', NEYTRAL: 'NEYTRAL' } as const;
const n = (v: number, d = 1) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/,/g, ' ');
const zoneTxt = (z: Zone) => (Math.abs(z.hi - z.lo) < 0.5 ? n(z.lo) : `${n(z.lo)} – ${n(z.hi)}`);
const OY = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
/** "2-noyabr 11:30" — Toshkent vaqti (UTC+5, yozgi vaqt yo'q). Brauzerning uz-UZ lokali oy nomini noto'g'ri beradi. */
const tash = (t: number) => {
  const d = new Date((t + 5 * 3600) * 1000);
  return `${d.getUTCDate()}-${OY[d.getUTCMonth()]} ${d.toISOString().slice(11, 16)}`;
};

function useLatest(open: boolean) {
  const [data, setData] = useState<Latest | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () =>
      fetch(`${BRIEF_URL}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j: Latest) => alive && (setData(j), setErr(false)))
        .catch(() => alive && setErr(true));
    load();
    const id = window.setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open]);
  return { data, err };
}

export default function BriefPanel({ open, onClose, price }: { open: boolean; onClose: () => void; price: number }) {
  const [tab, setTab] = useState<Tab>('brief');
  const { data, err } = useLatest(open);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div className="bp-overlay" onClick={onClose}>
      <aside className="bp" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Kunlik brif">
        <header className="bp-head">
          <b>Kunlik brif</b>
          <button className="btn xs icon" onClick={onClose} aria-label="Yopish">✕</button>
        </header>
        <nav className="bp-tabs">
          {([['brief', 'Brif'], ['cal', 'Kalendar'], ['stats', 'Natijalar'], ['lot', 'Lot']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>
        <div className="bp-body">
          {tab === 'lot' ? (
            <LotCalc price={price} />
          ) : !data ? (
            <p className="bp-empty">{err ? 'Bot ma\'lumoti hali yo\'q. Brif har ish kuni London ochilishidan oldin chiqadi.' : 'Yuklanmoqda…'}</p>
          ) : tab === 'brief' ? (
            <BriefView d={data} />
          ) : tab === 'cal' ? (
            <CalendarView d={data} />
          ) : (
            <StatsView d={data} />
          )}
        </div>
        <footer className="bp-foot">Bu tahlil ehtimollikka asoslangan, moliyaviy maslahat emas.</footer>
      </aside>
    </div>
  );
}

function BriefView({ d }: { d: Latest }) {
  const b = d.brief;
  const above = b.zones.filter((z) => z.side === 1).reverse();
  const below = b.zones.filter((z) => z.side === -1);
  const cls = b.bias === 'LONG' ? 'up' : b.bias === 'SHORT' ? 'down' : 'flat';
  return (
    <>
      <div className={`bp-bias ${cls}`}>
        <span>{tash(b.at)} (Toshkent vaqti)</span>
        <b>{BIAS_UZ[b.bias]} · {b.prob}%</b>
      </div>
      {d.prevEval && (
        <p className="bp-prev">
          Kecha: {d.prevEval.bias} {d.prevEval.biasOk ? '✅ to\'g\'ri' : '❌ xato'}
          {d.prevEval.plans.filter((p) => p.result !== 'ishga tushmadi').map((p, i) => <span key={i}> · {p.dir === 1 ? 'long' : 'short'} {p.result}</span>)}
        </p>
      )}
      {b.narrative && <p className="bp-text">{b.narrative}</p>}
      {b.notes.map((t) => <p key={t} className="bp-note">{t}</p>)}

      <h4>Zonalar</h4>
      <ul className="bp-zones">
        {above.map((z) => <ZoneRow key={`a${z.lo}`} z={z} />)}
        <li className="bp-now">Brif paytidagi narx · {n(b.price)}</li>
        {below.map((z) => <ZoneRow key={`b${z.lo}`} z={z} />)}
      </ul>

      <h4>Rejalar</h4>
      {b.plans.length ? b.plans.map((p, i) => <PlanCard key={i} p={p} />) : <p className="bp-note">Bugun R:R 1.5 dan yuqori aniq reja yo'q.</p>}
      {b.invalid && <p className="bp-note">Ssenariy bekor bo'ladi: {b.invalid.text}: <b>{n(b.invalid.price)}</b></p>}

      <h4>Omillar</h4>
      <ul className="bp-factors">
        {b.factors.map((f) => (
          <li key={f.key}>
            <span>{f.label}</span>
            <i className={f.value > 0.15 ? 'up' : f.value < -0.15 ? 'down' : ''} style={{ width: `${Math.round(Math.abs(f.value) * 100)}%` }} />
            <small>{f.note}</small>
          </li>
        ))}
      </ul>
      <p className="bp-src">Manba: {b.source} · yangilandi {tash(d.updatedAt)}</p>
    </>
  );
}

function ZoneRow({ z }: { z: Zone }) {
  return (
    <li className={z.side === 1 ? 'res' : 'sup'}>
      <b>{zoneTxt(z)}</b>
      <span className={`bp-str s-${z.strength === 'kuchli' ? 3 : z.strength === 'kuchsiz' ? 1 : 2}`}>{z.strength}</span>
      <small>{z.tags.slice(0, 3).join(' + ')}</small>
    </li>
  );
}

function PlanCard({ p }: { p: Plan }) {
  const long = p.dir === 1;
  return (
    <div className={`bp-plan ${long ? 'up' : 'down'}`}>
      <div className="bp-plan-h">
        <b>{long ? 'LONG' : 'SHORT'}</b>
        <span>{p.main ? 'asosiy' : 'qarshi tomon, kichik hajm'}{p.kind === 'buzilish' ? ' · buzilish' : ''}</span>
        <span className="rr">R:R {p.rr1} / {p.rr2}</span>
      </div>
      <p>
        {p.kind === 'buzilish'
          ? `H1 shami ${zoneTxt(p.zone)} zonasidan ${long ? 'yuqorida' : 'pastda'} yopilsin, keyin ${n(p.entry)} ga qayta test va M15 da rad etilish.`
          : `Narx ${zoneTxt(p.zone)} zonasiga killzone ichida kelsin, M15 da ${long ? 'SSL' : 'BSL'} sweep yoki CHoCH.`}
      </p>
      <dl>
        <div><dt>Kirish</dt><dd>{n(p.entry)}</dd></div>
        <div><dt>SL</dt><dd className="down">{n(p.sl)}</dd></div>
        <div><dt>TP1</dt><dd className="up">{n(p.tp1)}</dd></div>
        <div><dt>TP2</dt><dd className="up">{n(p.tp2)}</dd></div>
      </dl>
    </div>
  );
}

function CalendarView({ d }: { d: Latest }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const now = Date.now() / 1000;
  const list = d.upcoming.filter((e) => e.time > now - 1800);
  if (!list.length) return <p className="bp-empty">Bu hafta oldinda yuqori ta'sirli yangilik yo'q.</p>;
  const left = (t: number) => {
    const s = t - now;
    if (s <= 0) return 'hozir';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h >= 24 ? `${Math.floor(h / 24)} kun ${h % 24} soat` : `${h} soat ${m} daq`;
  };
  return (
    <ul className="bp-cal">
      {list.map((e) => (
        <li key={e.title + e.time}>
          <div><b>{e.title}</b><small>{tash(e.time)} · {left(e.time)}</small></div>
          {e.forecast && <span>prognoz <b>{e.forecast}</b> · oldingi {e.previous}</span>}
        </li>
      ))}
      <li className="bp-note">E'londan 15 daqiqa oldin va keyin yangi pozitsiya ochmang.</li>
    </ul>
  );
}

function StatsView({ d }: { d: Latest }) {
  const s = d.stats;
  if (!s.days) return <p className="bp-empty">Hali baholangan kun yo'q. Natijalar har kuni ertalab, oldingi kunning brifi tekshirilgach to'planadi.</p>;
  return (
    <div className="bp-stats">
      <div><span>Bias aniqligi</span><b>{s.biasAcc}%</b><small>{s.biasOk} / {s.days} kun</small></div>
      <div><span>Savdolar</span><b>{s.trades}</b><small>foydali {s.wins}</small></div>
      <div><span>Jami natija</span><b className={s.totalR >= 0 ? 'up' : 'down'}>{s.totalR >= 0 ? '+' : ''}{s.totalR}R</b><small>oxirgi 30 kun</small></div>
      <p className="bp-note">Reja "ishga tushdi" degani narx zonaga kirdi. TP1 dan keyin SL kirish narxiga ko'chirilgan deb hisoblanadi. Bitta shamda SL va TP ikkalasi bo'lsa, SL deb olinadi.</p>
    </div>
  );
}

function LotCalc({ price }: { price: number }) {
  const [dep, setDep] = useState('1000');
  const [risk, setRisk] = useState('1');
  const [entry, setEntry] = useState(price ? price.toFixed(2) : '');
  const [sl, setSl] = useState('');
  const num = (s: string) => (s.trim() === '' ? NaN : +s.replace(/\s/g, '').replace(',', '.'));
  const money = (num(dep) * num(risk)) / 100 || 0;
  const dist = Math.abs(num(entry) - num(sl)) || 0; // bo'sh maydon NaN -> 0 -> "—"
  const lots = dist > 0 ? money / (dist * 100) : 0;
  const lotsDown = Math.floor(lots * 100) / 100;
  return (
    <div className="bp-lot">
      <label>Depozit, $<input inputMode="decimal" value={dep} onChange={(e) => setDep(e.target.value)} /></label>
      <label>Risk, %<input inputMode="decimal" value={risk} onChange={(e) => setRisk(e.target.value)} /></label>
      <label>Kirish narxi<input inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} /></label>
      <label>Stop-loss<input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="masalan 3 890" /></label>
      <div className="bp-lot-res">
        <div><span>Risk summasi</span><b>{money > 0 ? `${n(money, 2)} $` : '—'}</b></div>
        <div><span>SL masofasi</span><b>{dist > 0 ? `${n(dist, 2)} $` : '—'}</b></div>
        <div className="big"><span>Lot</span><b>{lotsDown > 0 ? lotsDown.toFixed(2) : dist > 0 ? '< 0.01' : '—'}</b></div>
      </div>
      <p className="bp-note">
        XAU/USD da 1 lot = 100 untsiya: narx 1$ yursa, 1 lotda natija 100$ ga o'zgaradi. Lot pastga yaxlitlangan.
        {+risk > 2 && <b className="down"> Risk 2% dan yuqori, bu xavfli.</b>}
      </p>
    </div>
  );
}
