# AURUM · ICT Fibonacci Terminal

XAU/USD va kripto juftliklari uchun real vaqt tahlil terminali.

## Imkoniyatlar
- **Real vaqt grafik** (Binance WebSocket): XAU/USD (PAXG orqali), BTC, ETH, SOL, BNB, XRP · 1m–1d
- **ICT tahlil**: BOS / CHoCH, Fair Value Gap, Order Block, BSL/SSL, EQH/EQL, PDH/PDL, likvidlik sweep, killzone sessiyalar
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

> Tahlil ehtimollik vositasi, moliyaviy maslahat emas. PAXG narxi spot oltindan biroz farq qilishi mumkin.
