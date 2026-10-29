# AURUM · ICT Fibonacci Terminal

XAU/USD va kripto juftliklari uchun real vaqt tahlil terminali.

## Imkoniyatlar
- **Real vaqt grafik** (Binance WebSocket): XAU/USD — **Binance XAUUSDT perpetual** (spot oltinni kuzatadi, TradingView OANDA:XAUUSD ga mos), BTC, ETH, SOL, BNB, XRP · 1m–1d
- **Bid / Ask** (SOTISH / SOTIB OLISH), spred, spot oltin bozor soatlari (ochiq/yopiq), PAXG premium ko'rsatkichi
- **Och va qorong'i mavzu** ("banknota qog'ozi" / "seyf")
- **ICT tahlil**: BOS / CHoCH, Fair Value Gap, Order Block, BSL/SSL, EQH/EQL, PDH/PDL, Osiyo range (AsH/AsL), NY 00:00 Midnight Open, likvidlik sweep, NY vaqti bo'yicha (DST bilan) killzonalar va grafikda killzone soyalari
- **Fibonacci**: dealing range, 0.236–0.786, OTE (0.618–0.79), golden pocket, premium/discount, 1.272 / 1.618 targetlar
- **Konfluens bali** (−100…+100): 8 omil, katta taymfreym yo'nalishi, multi-timeframe matritsa
- **Avto setap**: kirish, OTE limit, SL, TP1–TP3, R:R
- **Backtest** (Web Worker): yuklangan tarixda strategiyaning win rate, profit factor, equity egri chizig'i
- **Demo savdo**: market/limit, SL/TP, risk % bo'yicha avtomatik hajm, tarix va statistika (brauzerda saqlanadi)
- **Signal bildirishnomalari** (brauzer notification)

## Ishga tushirish
```bash
npm install
npm run dev
```

## Deploy
Vercel → New Project → shu repo'ni import qiling → Deploy. Sozlash shart emas (Vite avtomatik aniqlanadi).

## Nega oldin narx TradingView'dan farq qilardi?
Oldingi versiya XAU/USD o'rniga Binance spot'dagi **PAXG** tokenini ko'rsatardi. PAXG — alohida kripto aktiv: 24/7 savdolanadi
va spot oltindan premium/discount bilan turadi (2026-10-29 da ~+3%, ya'ni ~$120). Endi asosiy manba — Binance USDⓈ-M
**XAUUSDT** perpetual. Futures API ochilmasa, PAXG zaxira sifatida ishlatiladi va sarlavhada "TAXMINIY" belgisi chiqadi.

> Tahlil ehtimollik vositasi, moliyaviy maslahat emas.
