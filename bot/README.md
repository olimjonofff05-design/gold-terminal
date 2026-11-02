# AURUM Telegram boti

Jamoaning yopiq kanaliga XAU/USD bo'yicha avtomatik hisobotlar yuboradi. Qoidalar va raqamlar
[`.claude/skills/xau-daily-brief/SKILL.md`](../.claude/skills/xau-daily-brief/SKILL.md) da. Bot shu faylni Gemini'ga system prompt
sifatida beradi, shuning uchun Claude bilan qo'lda qilingan tahlil va botning tahlili bir xil qoidaga bo'ysunadi.

Zonalar, struktura va skor saytning o'z tahlil kodidan (`src/lib/analysis.ts`) olinadi, shuning uchun sayt va bot bir xil darajalarni ko'rsatadi.

## Nima yuboradi

| Xabar | Qachon (Toshkent) |
|---|---|
| Ertalabki brif: bias va ehtimol, zonalar, kirish rejalari, kechagi brif bahosi | ish kunlari ~11:30 (yozda ~10:30) |
| Oltin bo'yicha 5 ta muhim yangilik (ovozsiz) | brifdan keyin |
| NY sessiyasi oldidan yangilash | ~16:30 (yozda ~15:30) |
| NFP / CPI / FOMC oldidan tahlil: ssenariylar, tarixiy harakat | voqeadan ~2 kun oldin |
| Yangilikka 45 daqiqadan kam qolganda ogohlantirish | |
| Narx kuchli zonaga yaqinlashdi | 15 daqiqalik tekshiruv |
| Haftalik xulosa: natijalar statistikasi, COT, keyingi hafta | yakshanba 20:00 dan |

## Qanday ishlaydi

- `.github/workflows/aurum-bot.yml` har 15 daqiqada `npx tsx src/main.ts auto` ni ishga tushiradi. Repo ochiq bo'lgani uchun GitHub Actions tekin.
- Bot vaqti kelgan ishlarni bajaradi va holatni `bot-data` branchiga yozadi: `latest.json`, `history.json` va `briefs/`.
- Sayt (📋 Brif tugmasi) `latest.json` ni shu branchdan o'qiydi.

## Kalitlar (GitHub → Settings → Secrets and variables → Actions → New repository secret)

| Nomi | Qayerdan |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather |
| `TELEGRAM_CHAT_ID` | kanal ID (`-100...`) |
| `GEMINI_API_KEY` | aistudio.google.com (tekin) |
| `FRED_API_KEY` | fred.stlouisfed.org (tekin) |

Lokal ishlatish uchun shu kalitlar repo ildizidagi `.env` fayliga yoziladi (namuna: `.env.example`). `.env` git'ga tushmaydi.

## Lokal sinov

```bash
cd bot
npm install
npx tsx src/main.ts morning --dry     # Telegram'ga yubormasdan ekranga chiqaradi
npx tsx src/main.ts preview --week --dry
npx tsx src/main.ts auto              # vaqti kelgan ishlarni haqiqatan yuboradi
```

Ishlar: `morning`, `ny`, `news`, `alerts`, `events`, `preview`, `weekly`, `auto`.
GitHub'da qo'lda ishga tushirish: Actions → AURUM bot → Run workflow → ish nomi.

## Cheklovlar

- GitHub cron 5-20 daqiqa kechikishi mumkin. Shuning uchun alertlar darhol emas, 15-30 daqiqa ichida keladi.
- GitHub serverlari AQShda. Binance ularni bloklasa, narx Yahoo `GC=F` dan olinadi va spotga moslanadi. Bunda zonalar saytdagidan 1-2$ farq qilishi mumkin. Manba brifda ko'rsatiladi.
- Gemini tekin tarifida flash modellar ba'zan band bo'ladi. Bot lite modeldan boshlaydi, ishlamasa keyingisiga o'tadi. Hammasi ishlamasa, brif shablon matni bilan chiqadi.
- Ochiq repoda 60 kun commit bo'lmasa, GitHub jadvalni to'xtatadi. Bot `bot-data` ga muntazam yozib turadi. Agar baribir to'xtasa, Actions sahifasida "Enable workflow" tugmasini bosish kifoya.
