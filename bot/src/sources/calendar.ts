import { getJson, log, nowSec } from '../util.ts';
import { loadJson, saveJson } from '../state.ts';

export interface CalEvent {
  title: string;
  time: number; // unix sekund
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  forecast: string;
  previous: string;
}

/** Bozorni qimirlatadigan asosiy voqealar — ular uchun alohida oldindan tahlil yoziladi */
export const MAJOR: { key: 'NFP' | 'CPI' | 'FOMC'; match: RegExp; name: string }[] = [
  { key: 'NFP', match: /^Non-Farm Employment Change$/i, name: 'NFP (Non-Farm Payrolls)' },
  { key: 'CPI', match: /^Core CPI m\/m$/i, name: 'CPI (inflyatsiya)' },
  { key: 'FOMC', match: /^Federal Funds Rate$/i, name: 'FOMC (Fed stavka qarori)' },
];

const FF = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const CACHE = 'calendar.json';

/**
 * ForexFactory haftalik kalendari (faqat USD). Fayl soatiga bir marta yangilanadi va manba
 * tez-tez so'rovni yoqtirmaydi — shuning uchun 1 soat keshlanadi.
 */
export async function calendar(): Promise<CalEvent[]> {
  const cached = loadJson<{ at: number; events: CalEvent[] } | null>(CACHE, null);
  if (cached && nowSec() - cached.at < 3600) return cached.events;
  try {
    const j = await getJson<{ title: string; country: string; date: string; impact: CalEvent['impact']; forecast: string; previous: string }[]>(FF);
    const events = j
      .filter((e) => e.country === 'USD')
      .map((e) => ({ title: e.title, time: Math.floor(Date.parse(e.date) / 1000), impact: e.impact, forecast: e.forecast, previous: e.previous }))
      .sort((a, b) => a.time - b.time);
    saveJson(CACHE, { at: nowSec(), events });
    return events;
  } catch (e) {
    log('Kalendar:', (e as Error).message);
    return cached?.events ?? [];
  }
}

export const highImpact = (ev: CalEvent[], from: number, to: number) => ev.filter((e) => e.impact === 'High' && e.time >= from && e.time < to);

/** Bir vaqtda chiqadigan voqealarni guruhlash (NFP, ishsizlik, ish haqi — hammasi 08:30 da) */
export function sameTime(ev: CalEvent[], t: number) {
  return ev.filter((e) => e.time === t && (e.impact === 'High' || e.impact === 'Medium'));
}
