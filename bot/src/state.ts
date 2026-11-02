import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BOT_DIR } from './util.ts';

/**
 * Bot holati JSON fayllarda. Lokalda — bot/state, GitHub Actions'da — `bot-data` branchi
 * (workflow uni STATE_DIR ga ochadi va ishdan keyin commit qiladi). Sayt `latest.json` ni o'qiydi.
 */
export const STATE_DIR = resolve(process.env.STATE_DIR || join(BOT_DIR, 'state'));

export function loadJson<T>(name: string, fallback: T): T {
  const f = join(STATE_DIR, name);
  if (!existsSync(f)) return fallback;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(name: string, data: unknown) {
  const f = join(STATE_DIR, name);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(data, null, 1));
}

/** Qaysi ish qachon bajarilgani va yuborilgan alertlar (takror yubormaslik uchun) */
export interface RunState {
  done: Record<string, string>; // job -> NY sana yoki voqea kaliti
  alerts: Record<string, number>; // kalit -> unix sekund
}
export const loadRun = () => loadJson<RunState>('run.json', { done: {}, alerts: {} });
export function saveRun(s: RunState) {
  // 10 kundan eski alert kalitlarini tozalash
  const cut = Date.now() / 1000 - 10 * 86400;
  for (const [k, t] of Object.entries(s.alerts)) if (t < cut) delete s.alerts[k];
  saveJson('run.json', s);
}
