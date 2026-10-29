# MT5 ko'prigi — saytda Exness MT5 narxini ko'rish

Bu kichik dastur kompyuteringizdagi **MetaTrader 5** dan oltin narxini o'qib, AURUM saytiga beradi.
Bitta broker hisobida narx barcha qurilmalarda bir xil bo'lgani uchun saytdagi grafik, Bid/Ask, SL va TP
**telefoningizdagi MT5 bilan sentigacha mos keladi**.

- Faqat narxlarni **o'qiydi**: savdo ochmaydi, hisobingizga hech narsa yozmaydi.
- Faqat shu kompyuterdan ulanadi (`127.0.0.1`). Internetdan unga hech kim kira olmaydi.
- Faqat **Windows** da ishlaydi (MetaQuotes'ning rasmiy `MetaTrader5` Python kutubxonasi shuni talab qiladi).

## Bir martalik o'rnatish (~10 daqiqa)

1. **Exness MT5 ni o'rnating**: Exness shaxsiy kabinetidan "MetaTrader 5" ni yuklab oling.
   Telefoningizdagi **o'sha hisob** bilan kiring (login, parol, server bir xil).
   "Kotirovkalar" (Market Watch) oynasida oltin ko'rinishini tekshiring. Standard hisobda u odatda `XAUUSDm` deb ataladi.
2. **Python o'rnating**: <https://www.python.org/downloads/> dan Python 3.12 (64-bit) ni yuklang.
   O'rnatishda **"Add python.exe to PATH"** katagini albatta belgilang.
3. **Ko'prikni yuklab oling**: shu papkadagi ikkita faylni (`aurum_bridge.py` va `start.bat`)
   bitta papkaga saqlang, masalan `C:\AURUM`.
   (GitHub'da repo sahifasidagi "Code → Download ZIP" orqali ham bo'ladi. ZIP ichidan `mt5-bridge` papkasini oling.)

## Har safar ishlatish

1. MT5 ni oching va hisobga kirilganini tekshiring.
2. `start.bat` ni ikki marta bosing. Birinchi marta u kerakli kutubxonani o'zi o'rnatadi.
   Qora oynada shunga o'xshash yozuv chiqadi:
   ```
   MT5 ga ulandi: Exness Technologies Ltd · server Exness-MT5Real… · hisob 1234567
   Simvol: XAUUSDm · Bid 4024.47 · Ask 4024.63
   Tayyor: http://127.0.0.1:8765
   ```
3. Saytni oching va grafik ustidagi **"Broker · MT5"** tugmasini bosing.
   Brauzer *"qurilmangizdagi boshqa ilovalarga ulanishga ruxsat"* so'rasa, **Ruxsat berish** ni bosing.
4. Yuqorida **MT5 LIVE**, grafik ostida esa `Manba: MT5 · Exness … · XAUUSDm · aniq broker narxi` chiqadi.

Qora oynani yopmang. Yopsangiz, sayt o'zi kalibrlangan rejimga qaytadi.

## Muammolar

| Belgi | Yechim |
|---|---|
| `Python topilmadi` | Python'ni qayta o'rnating va "Add python.exe to PATH" ni belgilang |
| `MT5 ga ulanib bo'lmadi` | MT5 ochiq va hisobga kirilganini tekshiring. |
| `Oltin simvoli topilmadi` | `start.bat --symbol XAUUSD` (MT5 dagi aniq nom bilan) |
| Bir nechta MT5 o'rnatilgan | `start.bat --path "C:\Program Files\MetaTrader 5 EXNESS\terminal64.exe"` |
| Sayt "MT5 ko'prigi ishlamayapti" deydi | Qora oyna ochiqligini va brauzer ruxsati berilganini tekshiring. Sahifani yangilang |
| Shamlar vaqti siljigan | `start.bat --tz 0` (broker server vaqti farqi, soatda). Odatda avtomatik aniqlanadi |

## Narx haqida eslatma

MT5 grafigi **Bid** (SOTISH) narxida chiziladi, sayt ham shunday qiladi. BUY ochganingizda **Ask** narxida kirasiz.
Buy pozitsiyaning SL'i Bid bo'yicha, Sell pozitsiyaning SL'i Ask bo'yicha ishlaydi. Shuning uchun SL'ni darajaga juda yaqin qo'ymang.
