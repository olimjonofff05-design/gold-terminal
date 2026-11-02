import { MAJOR, type CalEvent } from '../sources/calendar.ts';
import type { NewsItem } from '../sources/news.ts';
import { esc, px, tashTime, uzDate } from '../util.ts';
import type { MoveStats, Evaluation } from './evaluate.ts';
import type { BZone, Brief, Plan } from './build.ts';

/** Telegram HTML shablonlari — SKILL.md 8-bo'lim. Faqat <b> <i> <code> <a>. */

export const DISCLAIMER = '<i>Bu tahlil ehtimollikka asoslangan, moliyaviy maslahat emas.</i>';
const BIAS_UZ = { LONG: '🟢 LONG', SHORT: '🔴 SHORT', NEYTRAL: '⚪ NEYTRAL' } as const;

const zoneTxt = (z: BZone) => (Math.abs(z.hi - z.lo) < 0.5 ? px(z.lo) : `${px(z.lo)}-${px(z.hi)}`);
const zoneLine = (z: BZone) => `${z.side === 1 ? '🔴' : '🟢'} <code>${zoneTxt(z)}</code> · ${z.strength} · ${esc(z.tags.slice(0, 3).join(' + '))}`;

export function planBlock(p: Plan) {
  const long = p.dir === 1;
  const brk = p.kind === 'buzilish';
  const head = `${long ? '🟢 LONG' : '🔴 SHORT'} rejasi (${p.main ? 'asosiy' : 'qarshi tomon, kichik hajm'}${brk ? ', buzilish' : ''})`;
  const cond = brk
    ? `H1 shami zonadan ${long ? 'yuqorida' : 'pastda'} yopilsin, keyin narx <code>${px(p.entry, 1)}</code> ga qaytib tegsa (retest) va M15 da rad etilsa`
    : `narx zonaga London yoki NY killzone ichida kelsin, M15 da ${long ? 'SSL sweep (pastdagi stoplar olinib qaytish)' : 'BSL sweep (yuqoridagi stoplar olinib qaytish)'} yoki CHoCH bo'lsin`;
  return [
    `<b>${head}</b>`,
    `Zona: <code>${zoneTxt(p.zone)}</code> (${esc(p.zone.tags.slice(0, 2).join(' + '))})`,
    `Shart: ${cond}`,
    `Kirish: M15 tasdiq shami yopilishida, taxminan <code>${px(p.entry, 1)}</code>`,
    `SL: <code>${px(p.sl, 1)}</code>`,
    `TP1: <code>${px(p.tp1, 1)}</code> (${esc(p.tp1Tag)}) · TP2: <code>${px(p.tp2, 1)}</code> (${esc(p.tp2Tag)})`,
    `R:R: ${p.rr1} / ${p.rr2}`,
    `Bekor bo'ladi: H1 shami <code>${px(p.sl, 1)}</code> ${long ? 'ostida' : 'ustida'} yopilsa`,
  ].join('\n');
}

const evLine = (e: CalEvent) => `${e.impact === 'High' ? '🔴' : '🟠'} ${tashTime(e.time)} · ${esc(e.title)}${e.forecast ? ` (prognoz ${esc(e.forecast)}, oldingi ${esc(e.previous)})` : ''}`;

export function evalLine(ev: Evaluation) {
  const plans = ev.plans.filter((p) => p.result !== 'ishga tushmadi');
  const pr = plans.length ? plans.map((p) => `${p.dir === 1 ? 'long' : 'short'} ${p.result}${p.r ? ` (${p.r > 0 ? '+' : ''}${p.r.toFixed(1)}R)` : ''}`).join(', ') : 'rejalar ishga tushmadi';
  return `Kecha: ${BIAS_UZ[ev.bias]} ${ev.biasOk ? '✅ to\'g\'ri chiqdi' : '❌ xato chiqdi'} · ${pr}`;
}

export function morningMsg(b: Brief, prev: Evaluation | null) {
  const above = b.zones.filter((z) => z.side === 1);
  const below = b.zones.filter((z) => z.side === -1);
  const out = [
    `<b>☀️ XAU/USD · ${uzDate(b.at)}</b>`,
    `Narx: <code>${px(b.price, 1)}</code> · Kecha: ${b.changePct >= 0 ? '+' : ''}${b.changePct}% · ATR(D1): ${b.atrD1.toFixed(0)}$`,
  ];
  if (prev) out.push(evalLine(prev));
  out.push('', `<b>Bugungi kutilma: ${BIAS_UZ[b.bias]} · ${b.prob}%</b>`);
  out.push(esc(b.narrative ?? fallbackNarrative(b)));
  for (const n of b.notes) out.push(`<i>${esc(n)}</i>`);
  const evs = b.events.filter((e) => e.impact === 'High' || e.impact === 'Medium');
  if (evs.length) out.push('', '<b>⚠️ Bugungi yangiliklar (Toshkent vaqti)</b>', ...evs.slice(0, 5).map(evLine));
  out.push('', '<b>Yuqoridagi zonalar</b>', ...(above.length ? above.reverse().map(zoneLine) : ['yaqin atrofda yo\'q']));
  out.push('', '<b>Pastdagi zonalar</b>', ...(below.length ? below.map(zoneLine) : ['yaqin atrofda yo\'q']));
  if (b.plans.length) out.push('', ...b.plans.map(planBlock).join('\n\n').split('\n'));
  else out.push('', 'Bugun R:R 1.5 dan yuqori aniq reja yo\'q. Zonalardagi reaksiyani kuzating.');
  if (b.invalid) out.push('', `<b>Ssenariy bekor bo'ladi:</b> ${esc(b.invalid.text)}: <code>${px(b.invalid.price, 1)}</code>`);
  out.push('', `Lot hisoblash: risk 1% dan oshmasin. XAU'da 1 lot = 100 oz, narx 1$ yursa 100$.`, DISCLAIMER);
  return out.join('\n');
}

/** Gemini ishlamasa — faktorlardan qisqa izoh */
export function fallbackNarrative(b: Brief) {
  const top = [...b.factors].filter((f) => Math.abs(f.value) >= 0.3).sort((a, c) => Math.abs(c.value * c.weight) - Math.abs(a.value * a.weight)).slice(0, 3);
  if (!top.length) return 'Omillar aralash, aniq yo\'nalish yo\'q. Diapazon chegaralaridan qaytishni kuting.';
  return top.map((f) => f.note.charAt(0).toUpperCase() + f.note.slice(1)).join('. ') + '.';
}

export function nyUpdateMsg(b: Brief, morning: Brief | null) {
  const changed = morning && morning.bias !== b.bias;
  const near = b.zones.slice().sort((x, y) => Math.abs((x.lo + x.hi) / 2 - b.price) - Math.abs((y.lo + y.hi) / 2 - b.price)).slice(0, 3);
  const out = [
    `<b>🗽 NY sessiyasi oldidan · ${uzDate(b.at, false)}</b>`,
    `Narx: <code>${px(b.price, 1)}</code>${morning ? ` (ertalab ${px(morning.price, 1)}, ${b.price - morning.price >= 0 ? '+' : ''}${(b.price - morning.price).toFixed(1)}$)` : ''}`,
    `Kutilma: ${BIAS_UZ[b.bias]} · ${b.prob}%${changed ? ` ⚠️ ertalab ${BIAS_UZ[morning!.bias]} edi` : morning ? ' (ertalabgidek)' : ''}`,
    '',
    '<b>Narxga eng yaqin zonalar</b>',
    ...near.map(zoneLine),
  ];
  const evs = b.events.filter((e) => e.impact === 'High');
  if (evs.length) out.push('', '<b>⚠️ Oldinda</b>', ...evs.map(evLine), 'E\'londan 15 daqiqa oldin va keyin yangi pozitsiya ochmang.');
  if (b.plans.length) out.push('', ...planBlock(b.plans[0]).split('\n'));
  out.push('', DISCLAIMER);
  return out.join('\n');
}

export interface ScoredNews extends NewsItem { dir: 1 | -1 | 0; strength: 'kuchli' | "o'rta" | 'kuchsiz'; uz: string }
const DIR_ICON = { 1: '🟢', '-1': '🔴', 0: '⚪' } as const;
export function newsMsg(items: ScoredNews[]) {
  const out = ['<b>📰 Oltin uchun muhim yangiliklar</b>', ''];
  for (const n of items) {
    out.push(`${DIR_ICON[n.dir]} <b>${n.strength}</b> · ${esc(n.uz)} (${esc(n.source)})`, `<a href="${esc(n.link)}">manba</a>`, '');
  }
  out.push('🟢 oltin uchun ijobiy · 🔴 salbiy · ⚪ neytral', DISCLAIMER);
  return out.join('\n');
}

export function eventAlertMsg(evs: CalEvent[], atr: number) {
  const t = evs[0].time;
  return [
    `<b>⏰ ${Math.max(1, Math.round((t - Date.now() / 1000) / 60))} daqiqadan keyin: ${esc(evs.map((e) => e.title).join(', '))}</b>`,
    `Vaqt: ${tashTime(t)} (Toshkent)`,
    ...evs.filter((e) => e.forecast).map((e) => `${esc(e.title)}: prognoz <b>${esc(e.forecast)}</b>, oldingi ${esc(e.previous)}`),
    '',
    `Volatillik oshadi. Hozirgi H1 ATR: ${atr.toFixed(1)}$, e'londa harakat bundan 2-4 barobar katta bo'lishi mumkin.`,
    'Ochiq pozitsiyada SL turganini tekshiring. Yangi kirish faqat birinchi M15 sham yopilgandan keyin.',
  ].join('\n');
}

export function zoneAlertMsg(z: BZone, price: number, plans: Plan[]) {
  const out = [
    `<b>📍 Narx zonaga yaqinlashdi: <code>${zoneTxt(z)}</code></b>`,
    `Hozir: <code>${px(price, 1)}</code> · zona ${z.strength} · ${esc(z.tags.slice(0, 3).join(' + '))}`,
  ];
  if (plans.length) for (const p of plans) out.push('', ...planBlock(p).split('\n'));
  else out.push('Bu zona uchun bugun reja yo\'q. Reaksiyani kuzating, M15 tasdiqsiz kirmang.');
  return out.join('\n');
}

export interface PreviewData {
  key: (typeof MAJOR)[number]['key'];
  name: string;
  events: CalEvent[];
  stats: MoveStats | null;
  context: string; // Gemini fon izohi (bo'sh bo'lishi mumkin)
}
const SCEN: Record<PreviewData['key'], [string, string, string][]> = {
  NFP: [
    ['NFP prognozdan 50k+ yuqori, ish haqi ham kuchli', 'ko\'tariladi', '🔴 pasayish, birinchi impuls odatda kuchli'],
    ['Prognozga yaqin (±50k)', 'aralash', '⚪ ikki tomonga "arra", birinchi harakat ko\'pincha qaytadi'],
    ['NFP prognozdan 50k+ past yoki ishsizlik oshdi', 'tushadi', '🟢 ko\'tarilish'],
    ['Bir raqam kuchli, boshqasi kuchsiz', 'noaniq', '⚪ ish haqi va revisiyalar hal qiladi'],
  ],
  CPI: [
    ['Core CPI prognozdan 0.1+ yuqori', 'ko\'tariladi', '🔴 pasayish, Fed stavkani uzoqroq yuqori ushlaydi'],
    ['Prognozga teng', 'aralash', '⚪ qisqa "arra", keyin trend davom etadi'],
    ['Core CPI prognozdan 0.1+ past', 'tushadi', '🟢 ko\'tarilish, stavka pasayishi kutilmasi oshadi'],
  ],
  FOMC: [
    ['Stavka kutilgandan qattiqroq yoki "hawkish" ohang', 'ko\'tariladi', '🔴 pasayish'],
    ['Kutilganday, ohang o\'zgarmagan', 'aralash', '⚪ asosiy harakat matbuot konferensiyasida'],
    ['Kutilmagan pasaytirish yoki "dovish" ohang', 'tushadi', '🟢 ko\'tarilish'],
  ],
};

export function previewMsg(d: PreviewData) {
  const t = d.events[0].time;
  const out = [`<b>📊 ${esc(d.name)} oldidan tahlil</b>`, `Sana: ${uzDate(t)} · ${tashTime(t)} Toshkent`, ''];
  out.push('<b>Raqamlar</b>', ...d.events.map((e) => `• ${esc(e.title)}: prognoz <b>${esc(e.forecast || '—')}</b>, oldingi ${esc(e.previous || '—')}`));
  if (d.context) out.push('', '<b>Fon</b>', esc(d.context));
  out.push('', '<b>Ssenariylar</b>');
  for (const [res, usd, gold] of SCEN[d.key]) out.push(`• ${res}\n   Dollar ${usd} → oltin: ${gold}`);
  if (d.stats) out.push('', `<b>Kutilgan harakat</b>`, `Oxirgi ${d.stats.n} ta e'londa birinchi 60 daqiqada oltin o'rtacha <b>${d.stats.avg.toFixed(0)}$</b>, eng ko'pi ${d.stats.max.toFixed(0)}$ yurgan.`);
  out.push('', '<b>Amaliy qoida</b>', 'E\'londan 15 daqiqa oldin va keyin yangi pozitsiya ochilmaydi. Ochiq pozitsiyada SL bo\'lishi shart. Kirish birinchi M15 sham yopilgandan keyin, uning chetidan qaytish yoki buzilish tasdig\'i bilan.');
  out.push('', DISCLAIMER);
  return out.join('\n');
}
