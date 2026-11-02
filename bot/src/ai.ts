import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Brief } from './brief/build.ts';
import type { NewsItem } from './sources/news.ts';
import type { ScoredNews } from './brief/render.ts';
import { env, getJson, log, ROOT_DIR } from './util.ts';

/**
 * Gemini faqat matn yozadi va yangiliklarni saralaydi. Raqamlar unga tayyor holda beriladi.
 * Ishlamasa — null qaytadi va bot shablon matni bilan davom etadi.
 * System prompt — o'sha skill fayli: Claude bilan qo'lda tahlil va bot bir xil qoidaga bo'ysunadi.
 */
const SKILL = (() => {
  try {
    return readFileSync(join(ROOT_DIR, '.claude/skills/xau-daily-brief/SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
  } catch {
    return '';
  }
})();

const SYSTEM = `${SKILL}

---
Sen AURUM Telegram botining matn yozuvchisisan. Yuqoridagi qoidalarga qat'iy amal qil.
Faqat senga berilgan raqamlarni ishlat, yangi narx darajasi o'ylab topma.
Uzun tire (—) ishlatma. "Aniq", "kafolat", "100%" so'zlarini ishlatma. HTML teg yozma.`;

// Tekin tarifda flash modellar tez-tez band ("high demand") yoki 60+ soniya o'ylaydi;
// lite modellar 1-2 soniyada javob beradi. Birinchisi ishlamasa — keyingisi.
const MODELS = [...new Set([env('GEMINI_MODEL', false) || 'gemini-flash-lite-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-flash-latest'])];

async function gemini(prompt: string, json = false): Promise<string | null> {
  const key = env('GEMINI_API_KEY', false);
  if (!key) return null;
  for (const model of MODELS) {
    try {
      const j = await getJson<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, ...(json ? { responseMimeType: 'application/json' } : {}) },
          }),
        },
        40000,
      );
      const t = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
      if (t) return t.replace(/\s*—\s*/g, ', ');
    } catch (e) {
      log(`Gemini ${model}:`, (e as Error).message);
    }
  }
  return null;
}

/** Brifning 2-3 gaplik izohi */
export async function narrative(b: Brief): Promise<string | null> {
  const facts = {
    bias: b.bias,
    ehtimol: b.prob,
    narx: b.price,
    faktorlar: b.factors.map((f) => ({ omil: f.label, qiymat: +f.value.toFixed(2), izoh: f.note })),
    izohlar: b.notes,
    bugungi_yangiliklar: b.events.map((e) => e.title),
  };
  const t = await gemini(
    `Ertalabki brif uchun "Bugungi kutilma" ostidagi izohni yoz: 2-3 qisqa gap, o'zbek lotin, jonli til. ` +
      `Nega aynan shu bias ekanini eng kuchli 2-3 omil bilan tushuntir, qarshi omil bo'lsa bitta gap bilan ayt. ` +
      `Narx darajalari va zonalarni yozma, ular alohida beriladi. Faqat izoh matnini qaytar: sarlavha, bias qatori va disclaimer yozma.\n\nMa'lumot:\n${JSON.stringify(facts)}`,
  );
  const c = t ? clean(t) : '';
  return c && c.length < 700 ? c : null;
}

/** Model ba'zan sarlavha, HTML teg va disclaimer qo'shadi — ular shablonda bor, shu yerda olib tashlanadi */
function clean(t: string) {
  return t
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .split('\n')
    .map((l) => l.trim())
    // sarlavhalar nuqta bilan tugamaydi — faqat to'liq gaplar qoladi
    .filter((l) => l && !/^bugungi kutilma|moliyaviy maslahat emas/i.test(l) && /[.!?]$/.test(l))
    .join(' ')
    .trim();
}

/** Yangiliklarni saralash: faqat oltinga tegishlilari, yo'nalish va kuch bilan */
export async function scoreNews(items: NewsItem[], max = 5): Promise<ScoredNews[] | null> {
  if (!items.length) return [];
  const list = items.map((n, i) => `${i}. ${n.title} (${n.source})`).join('\n');
  const t = await gemini(
    `Quyidagi yangiliklardan oltin (XAU/USD) narxiga ta'sir qiladiganlarini tanla, ko'pi bilan ${max} ta, eng muhimi birinchi. ` +
      `Takrorlanganlarini bitta qil. Har biri uchun JSON qaytar: ` +
      `[{"i": raqam, "dir": 1 (oltin uchun ijobiy) | -1 (salbiy) | 0, "strength": "kuchli"|"o'rta"|"kuchsiz", "uz": "o'zbekcha bir gap: nima bo'ldi va oltinga nega shunday ta'sir qiladi"}]. ` +
      `Tegishli yangilik bo'lmasa [] qaytar.\n\n${list}`,
    true,
  );
  if (!t) return null;
  try {
    const arr = JSON.parse(t) as { i: number; dir: number; strength: string; uz: string }[];
    return arr
      .filter((x) => items[x.i])
      .slice(0, max)
      .map((x) => ({ ...items[x.i], dir: (Math.sign(x.dir) as 1 | -1 | 0), strength: (['kuchli', "o'rta", 'kuchsiz'].includes(x.strength) ? x.strength : "o'rta") as ScoredNews['strength'], uz: x.uz }));
  } catch {
    return null;
  }
}

/** NFP/CPI/FOMC oldidan fon: so'nggi yangiliklar sarlavhalari asosida 2-3 gap */
export async function eventContext(name: string, headlines: NewsItem[]): Promise<string> {
  const t = await gemini(
    `${name} e'loni oldidan "Fon" bo'limini yoz: 2-3 gap, o'zbek lotin. Bozor nimani kutyapti, oldingi ma'lumotlar (ADP, JOLTS, claims, PPI va h.k.) nimani ko'rsatdi. ` +
      `Faqat quyidagi sarlavhalarda bor narsani ayt, bilmagan raqamingni yozma.\n\n${headlines.map((h) => '- ' + h.title).join('\n')}`,
  );
  const c = t ? clean(t) : '';
  return c.length < 800 ? c : '';
}
