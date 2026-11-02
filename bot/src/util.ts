import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { nyParts } from '../../src/lib/data.ts';

export const BOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT_DIR = resolve(BOT_DIR, '..');

// lokalda .env (repo ildizida yoki bot/ ichida), CI da — GitHub Secrets orqali env
for (const f of [join(ROOT_DIR, '.env'), join(BOT_DIR, '.env')]) if (existsSync(f)) process.loadEnvFile(f);

export const env = (k: string, required = true): string => {
  const v = process.env[k]?.trim() ?? '';
  if (!v && required) throw new Error(`${k} topilmadi (.env yoki GitHub Secrets)`);
  return v;
};

export const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));
export const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
export const nowSec = () => Math.floor(Date.now() / 1000);

export async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 aurum-bot', ...(init.headers ?? {}) } });
    if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function getText(url: string, timeoutMs = 15000): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 aurum-bot' } });
    if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

// ---------------- vaqt ----------------
/** NY vaqti: soat (kasr bilan), hafta kuni, NY sanasi YYYY-MM-DD */
export function ny(tSec = nowSec()) {
  const p = nyParts(tSec);
  const local = new Date((tSec + p.offset) * 1000);
  return {
    hour: p.hour + p.minute / 60,
    weekday: p.weekday, // 'Mon'..'Sun'
    date: local.toISOString().slice(0, 10),
    offset: p.offset,
  };
}

/** NY sanasining 00:00 si (unix sekund) */
export function nyMidnight(tSec = nowSec()) {
  const off = nyParts(tSec).offset;
  return Math.floor((tSec + off) / 86400) * 86400 - off;
}

const TASH_OFF = 5 * 3600;
export const tashTime = (tSec: number) => new Date((tSec + TASH_OFF) * 1000).toISOString().slice(11, 16);

const OY = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const KUN = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];
/** "3-noyabr, dushanba" (Toshkent sanasi) */
export function uzDate(tSec: number, withDay = true) {
  const d = new Date((tSec + TASH_OFF) * 1000);
  return `${d.getUTCDate()}-${OY[d.getUTCMonth()]}${withDay ? `, ${KUN[d.getUTCDay()]}` : ''}`;
}

/** 4031.4 -> "4 031" ; d=1 -> "4 031.4" */
export function px(v: number, d = 0) {
  const s = v.toFixed(d);
  const [i, f] = s.split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (f ? '.' + f : '');
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
