import { eventContext, narrative, scoreNews } from './ai.ts';
import { buildBrief, type Brief } from './brief/build.ts';
import { evaluate, eventMoves, type Evaluation } from './brief/evaluate.ts';
import { DISCLAIMER, eventAlertMsg, evalLine, morningMsg, newsMsg, nyUpdateMsg, previewMsg, zoneAlertMsg } from './brief/render.ts';
import { calendar, MAJOR, sameTime } from './sources/calendar.ts';
import { candles } from './sources/candles.ts';
import { cot } from './sources/macro.ts';
import { news } from './sources/news.ts';
import { loadJson, loadRun, saveJson, saveRun, type RunState } from './state.ts';
import { DRY, send } from './telegram.ts';
import { esc, log, nowSec, ny, px, tashTime, uzDate } from './util.ts';

/**
 * Ishga tushirish:
 *   npx tsx src/main.ts auto            — vaqti kelgan ishlarni bajaradi (GitHub Actions har 15 daqiqada)
 *   npx tsx src/main.ts morning --dry   — bitta ishni majburan, Telegram'ga yubormasdan
 * Ishlar: morning, ny, news, alerts, events, preview, weekly
 */

type Job = (run: RunState) => Promise<void>;

interface Latest { updatedAt: number; brief: Brief; prevEval: Evaluation | null; stats: Stats; upcoming: { title: string; time: number; forecast: string; previous: string }[] }
interface Stats { days: number; biasOk: number; biasAcc: number; trades: number; wins: number; totalR: number }

function stats(hist: Evaluation[], days = 30): Stats {
  const h = hist.slice(-days);
  const trades = h.flatMap((e) => e.plans.filter((p) => ['TP1', 'TP2', 'SL'].includes(p.result)));
  const biasOk = h.filter((e) => e.biasOk).length;
  return {
    days: h.length,
    biasOk,
    biasAcc: h.length ? Math.round((biasOk / h.length) * 100) : 0,
    trades: trades.length,
    wins: trades.filter((p) => p.r > 0).length,
    totalR: +trades.reduce((s, p) => s + p.r, 0).toFixed(1),
  };
}

async function saveLatest(brief: Brief, prevEval: Evaluation | null) {
  const cal = await calendar();
  const now = nowSec();
  const latest: Latest = {
    updatedAt: now,
    brief,
    prevEval,
    stats: stats(loadJson<Evaluation[]>('history.json', [])),
    upcoming: cal.filter((e) => e.impact === 'High' && e.time > now).slice(0, 12),
  };
  saveJson('latest.json', latest);
  saveJson(`briefs/${brief.date}.json`, brief);
}

// ---------------- ishlar ----------------
const morning: Job = async (run) => {
  const b = await buildBrief();
  // kechagi brifni baholash
  const prev = loadJson<Latest | null>('latest.json', null);
  let ev: Evaluation | null = null;
  if (prev && prev.brief.date !== b.date) {
    ev = await evaluate(prev.brief);
    if (ev) {
      const hist = loadJson<Evaluation[]>('history.json', []).filter((h) => h.date !== ev!.date);
      hist.push(ev);
      saveJson('history.json', hist.slice(-400));
    }
  }
  b.narrative = (await narrative(b)) ?? undefined;
  await saveLatest(b, ev);
  await send(morningMsg(b, ev));
  run.done.morning = b.date;
  await newsJob(run);
};

const nyUpdate: Job = async (run) => {
  const prev = loadJson<Latest | null>('latest.json', null);
  const b = await buildBrief();
  const m = prev && prev.brief.date === b.date ? prev.brief : null;
  // izoh ertalabki omillar uchun yozilgan; bias o'zgarmagan bo'lsa saytda saqlanib qoladi
  if (m && m.bias === b.bias) b.narrative = m.narrative;
  await saveLatest(b, prev?.prevEval ?? null);
  await send(nyUpdateMsg(b, m));
  run.done.ny = b.date;
};

const newsJob: Job = async (run) => {
  const items = await news(24);
  const scored = await scoreNews(items);
  if (scored === null) log('Yangiliklar: Gemini javob bermadi, o\'tkazib yuborildi');
  else if (scored.length) await send(newsMsg(scored), { silent: true });
  run.done.news = ny().date;
};

const alerts: Job = async (run) => {
  const latest = loadJson<Latest | null>('latest.json', null);
  if (!latest || latest.brief.date !== ny().date) return;
  const b = latest.brief;
  const price = (await candles('15m', 2)).at(-1)!.close;
  for (const z of b.zones) {
    if (z.score < 2) continue;
    const dist = price > z.hi ? price - z.hi : price < z.lo ? z.lo - price : 0;
    if (dist > 0.3 * b.atrH1) continue;
    const key = `zone:${b.date}:${z.lo.toFixed(1)}`;
    if (run.alerts[key]) continue;
    const plans = b.plans.filter((p) => p.zone.lo === z.lo && p.zone.hi === z.hi);
    if (await send(zoneAlertMsg(z, price, plans))) run.alerts[key] = nowSec();
  }
};

const events: Job = async (run) => {
  const now = nowSec();
  const cal = await calendar();
  const soon = cal.filter((e) => e.impact === 'High' && e.time > now && e.time <= now + 45 * 60);
  if (!soon.length) return;
  const t = soon[0].time;
  const key = `ev:${t}`;
  if (run.alerts[key]) return;
  const h1 = await candles('1h', 30);
  const atr = h1.slice(-14).reduce((s, c) => s + c.high - c.low, 0) / 14;
  if (await send(eventAlertMsg(sameTime(cal, t), atr))) run.alerts[key] = now;
};

const RELEASE: Record<string, number> = { NFP: 50, CPI: 10 };
const preview: Job = async (run) => {
  const now = nowSec();
  const cal = await calendar();
  for (const m of MAJOR) {
    const win = process.argv.includes('--week') ? 7 * 86400 : 52 * 3600; // --week: sinov uchun
    const e = cal.find((x) => m.match.test(x.title) && x.time > now && x.time - now <= win);
    if (!e) continue;
    const key = `pv:${m.key}:${e.time}`;
    if (run.alerts[key]) continue;
    const related = sameTime(cal, e.time);
    const stats = RELEASE[m.key] ? await eventMoves(RELEASE[m.key]).catch(() => null) : null;
    const heads = (await news(72, 60)).filter((n) => /job|payroll|employ|labor|ADP|JOLTS|claims|inflation|CPI|PPI|Fed|FOMC|rate/i.test(n.title)).slice(0, 25);
    const context = await eventContext(m.name, heads);
    if (await send(previewMsg({ key: m.key, name: m.name, events: related.length ? related : [e], stats, context }))) run.alerts[key] = now;
  }
};

const weekly: Job = async (run) => {
  const hist = loadJson<Evaluation[]>('history.json', []);
  const week = hist.filter((h) => Date.parse(h.date) / 1000 > nowSec() - 8 * 86400);
  const s = stats(week, 7);
  const co = await cot();
  const cal = await calendar();
  const now = nowSec();
  const next = cal.filter((e) => e.impact === 'High' && e.time > now);
  const out = [`<b>📅 Haftalik xulosa · ${uzDate(now, false)}</b>`, ''];
  out.push('<b>Bot natijalari (shu hafta)</b>');
  if (week.length) {
    out.push(...week.map(evalLine).map((l, i) => l.replace('Kecha', week[i].date.slice(5))));
    out.push(`Bias aniqligi: <b>${s.biasOk}/${s.days}</b> (${s.biasAcc}%) · Savdolar: ${s.trades}, foydali ${s.wins} · Jami: <b>${s.totalR >= 0 ? '+' : ''}${s.totalR}R</b>`);
  } else out.push('Bu hafta baholangan brif yo\'q.');
  if (co) {
    const d = co.net - co.netPrev;
    out.push('', '<b>COT: fondlar pozitsiyasi</b>', `Managed money net long: <b>${px(co.net)}</b> kontrakt (haftada ${d >= 0 ? '+' : ''}${px(d)}). 3 yillik diapazonning ${co.index3y.toFixed(0)}% ida.` +
      (co.index3y > 90 ? ' Haddan tashqari ko\'p long, keskin tushish xavfi oshgan.' : co.index3y < 10 ? ' Long juda kam, qisqa yopilish (short squeeze) ehtimoli bor.' : ''));
  }
  out.push('', '<b>Oldindagi muhim yangiliklar (Toshkent vaqti)</b>', ...(next.length ? next.slice(0, 10).map((e) => `🔴 ${uzDate(e.time, false)} ${tashTime(e.time)} · ${esc(e.title)}${e.forecast ? ` (prognoz ${esc(e.forecast)})` : ''}`) : ['ForexFactory hali yangi haftani e\'lon qilmagan.']));
  out.push('', DISCLAIMER);
  await send(out.join('\n'));
  run.done.weekly = ny().date;
};

const JOBS: Record<string, Job> = { morning, ny: nyUpdate, news: newsJob, alerts, events, preview, weekly };

/** Jadval — SKILL.md "Vaqtlar". GitHub cron kechikishi mumkin, shuning uchun "oraliq + bajarilmagan" mantiqi. */
async function auto(run: RunState) {
  const n = ny();
  const weekday = !['Sat', 'Sun'].includes(n.weekday);
  const h = n.hour;
  const tashH = (new Date().getUTCHours() + 5) % 24;
  const tashSun = new Date(Date.now() + 5 * 3600e3).getUTCDay() === 0;
  const due: string[] = [];
  if (weekday) {
    if (run.done.morning !== n.date && h >= 1.5 && h < 10) due.push('morning');
    else if (run.done.morning === n.date && run.done.ny !== n.date && h >= 6.5 && h < 10) due.push('ny');
    if (h < 17) due.push('alerts');
    due.push('events');
    if (h >= 1.5 && h < 12) due.push('preview');
  }
  if (tashSun && tashH >= 20 && run.done.weekly !== n.date) due.push('weekly');
  log(`NY ${n.date} ${n.weekday} ${h.toFixed(2)} → ${due.join(', ') || 'ish yo\'q'}`);
  for (const j of due) {
    try {
      await JOBS[j](run);
    } catch (e) {
      log(`${j} xato:`, (e as Error).stack ?? e);
      process.exitCode = 1; // qolgan ishlar bajariladi, lekin GitHub Actions'da natija qizil bo'ladi
    }
    saveRun(run);
  }
}

const cmd = process.argv[2] ?? 'auto';
// Kalitsiz bot jim ishlab, hech narsa yubormaydi — buni darhol va aniq aytamiz
const missing = DRY ? [] : ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'GEMINI_API_KEY', 'FRED_API_KEY'].filter((k) => !process.env[k]?.trim());
if (missing.length) {
  console.error(`Kalitlar topilmadi: ${missing.join(', ')}. GitHub: Settings → Secrets and variables → Actions → Repository secrets.`);
  process.exit(1);
}
const run = loadRun();
if (cmd === 'auto') await auto(run);
else if (JOBS[cmd]) {
  await JOBS[cmd](run);
  if (!DRY) saveRun(run);
} else {
  console.error(`Noma'lum ish: ${cmd}. Mavjud: auto, ${Object.keys(JOBS).join(', ')}`);
  process.exit(1);
}
