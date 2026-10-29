"""
AURUM · MT5 ko'prigi
====================
Kompyuterdagi MetaTrader 5 (masalan, Exness) dan oltin narxini o'qib, AURUM saytiga beradi.
Sayt shunda telefoningizdagi MT5 bilan sentigacha bir xil narxni ko'rsatadi
(bitta broker hisobida narx barcha qurilmalarda bir xil).

Ishga tushirish: start.bat ni ikki marta bosing (yoki: python aurum_bridge.py)
Faqat shu kompyuterdan (127.0.0.1) ulanish mumkin — tashqaridan hech kim kira olmaydi.
Dastur faqat narxlarni O'QIYDI: savdo ochmaydi, hisobingizga hech narsa yozmaydi.
"""
import argparse
import json
import ssl
import urllib.request
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    import MetaTrader5 as mt5
except ImportError:  # pragma: no cover
    print("XATO: MetaTrader5 kutubxonasi o'rnatilmagan. start.bat ni ishga tushiring yoki: pip install MetaTrader5")
    input("Chiqish uchun Enter...")
    sys.exit(1)

VERSION = "1.3.1"
SITE = __import__("os").environ.get("AURUM_SITE", "https://gold-terminal-three.vercel.app")  # sayt shu manzildan 127.0.0.1:8765 orqali ochiladi
PORT = 8765
# Exness: Standard -> XAUUSDm, Standard Cent -> XAUUSDc, Pro/Raw/Zero -> XAUUSD; boshqa brokerlar: GOLD
CANDIDATES = ["XAUUSDm", "XAUUSD", "XAUUSDc", "XAUUSD.", "XAUUSD#", "GOLD", "GOLDm", "XAUUSDz"]

TF = {
    "1m": mt5.TIMEFRAME_M1, "5m": mt5.TIMEFRAME_M5, "15m": mt5.TIMEFRAME_M15, "1h": mt5.TIMEFRAME_H1,
    "4h": mt5.TIMEFRAME_H4, "1d": mt5.TIMEFRAME_D1, "1w": mt5.TIMEFRAME_W1,
}

lock = threading.Lock()  # MetaTrader5 kutubxonasi bir vaqtda bitta so'rovni yaxshi ko'radi
state = {"symbol": None, "offset": 0, "offset_fixed": False, "broker": "", "server": "", "login": 0}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


_last_try = [0.0]


def connect(path=None, quiet=False):
    """MT5 ga ulanish. Qayta urinishlar 5 soniyada bir martadan oshmaydi (so'rovlar osilib qolmasin)."""
    if time.time() - _last_try[0] < 5:
        return False
    _last_try[0] = time.time()
    kw = {"timeout": 4000}
    ok = mt5.initialize(path, **kw) if path else mt5.initialize(**kw)
    if not ok:
        if not quiet:
            log("MT5 ga ulanib bo'lmadi:", mt5.last_error(), "— MT5 ochiq va hisobga kirilganini tekshiring.")
        return False
    acc = mt5.account_info()
    ti = mt5.terminal_info()
    state["broker"] = (getattr(acc, "company", "") if acc else "") or (ti.company if ti else "") or ""
    state["server"] = (acc.server if acc else "") or ""
    state["login"] = acc.login if acc else 0
    log(f"MT5 ga ulandi: {state['broker']} · server {state['server']} · hisob {state['login']}")
    return True


def pick_symbol(wanted=None):
    names = [wanted] if wanted else []
    names += CANDIDATES
    for n in names:
        if n and mt5.symbol_info(n) is not None:
            mt5.symbol_select(n, True)
            return n
    # oxirgi urinish: nomida XAU yoki GOLD bor birinchi simvol
    for s in mt5.symbols_get() or []:
        if ("XAU" in s.name and "USD" in s.name) or s.name.upper().startswith("GOLD"):
            mt5.symbol_select(s.name, True)
            return s.name
    return None


def refresh_account():
    """Foydalanuvchi MT5 da boshqa hisobga (masalan Exness) o'tsa — broker, server va simvolni qayta aniqlaymiz."""
    acc = mt5.account_info()
    if not acc:
        return
    if acc.login != state["login"] or acc.server != state["server"] or mt5.symbol_info(state["symbol"] or "") is None:
        ti = mt5.terminal_info()
        state["login"], state["server"] = acc.login, acc.server
        state["broker"] = (acc.company if getattr(acc, "company", "") else (ti.company if ti else "")) or ""
        sym = pick_symbol(ARGS.symbol if ARGS else None)
        if sym:
            state["symbol"] = sym
        if not state["offset_fixed"]:
            state["offset"] = 0
        log(f"Hisob o'zgardi: {state['broker']} · server {state['server']} · hisob {state['login']} · simvol {state['symbol']}")


def detect_offset():
    """MT5 vaqti broker server vaqtida (masalan UTC+0 yoki UTC+2/3). Haqiqiy UTC ga o'tkazish uchun farqni topamiz."""
    if state["offset_fixed"]:
        return
    t = mt5.symbol_info_tick(state["symbol"])
    if not t or not t.time:
        return
    diff = t.time - time.time()
    # faqat yangi tik bo'lsa (bozor ochiq) ishonamiz: farq soatga yaxlitlanadi
    off = int(round(diff / 1800.0)) * 1800
    if abs(diff - off) < 120:
        if off != state["offset"]:
            log(f"Server vaqti farqi: {off / 3600:+.1f} soat")
        state["offset"] = off


def rates(tf, limit):
    r = mt5.copy_rates_from_pos(state["symbol"], TF[tf], 0, max(1, min(limit, 5000)))
    if r is None:
        return []
    off = state["offset"]
    # Binance formatiga o'xshash: [ochilish_ms, open, high, low, close, volume]
    return [[(int(x["time"]) - off) * 1000, float(x["open"]), float(x["high"]), float(x["low"]), float(x["close"]), float(x["tick_volume"])] for x in r]


def tick():
    t = mt5.symbol_info_tick(state["symbol"])
    info = mt5.symbol_info(state["symbol"])
    if not t:
        return None
    d1 = mt5.copy_rates_from_pos(state["symbol"], mt5.TIMEFRAME_D1, 0, 1)
    return {
        "bid": t.bid, "ask": t.ask, "last": t.last, "time": (t.time - state["offset"]) * 1000,
        "dayOpen": float(d1[0]["open"]) if d1 is not None and len(d1) else None,
        "digits": info.digits if info else 2,
    }


_site_cache = {}


def proxy_site(path):
    """Saytni ko'prik orqali beramiz: brauzer sayt va narxni bitta manzildan (127.0.0.1) oladi,
    shuning uchun Chrome'ning lokal tarmoq bloki (Local Network Access) ishlamaydi."""
    key = path or "/"
    hit = _site_cache.get(key)
    if hit and (key.startswith("/assets/") or time.time() - hit[2] < 30):
        return hit
    url = SITE + key + ("" if key.startswith("/assets/") else f"?_={int(time.time())}")
    req = urllib.request.Request(url, headers={"User-Agent": "AURUM-bridge/" + VERSION, "Cache-Control": "no-cache", "Pragma": "no-cache"})
    with urllib.request.urlopen(req, timeout=15, context=ssl.create_default_context()) as r:
        body = r.read()
        ctype = r.headers.get("Content-Type", "application/octet-stream")
    out = (ctype, body, time.time())
    _site_cache[key] = out
    return out


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # jim
        pass

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass  # brauzer so'rovni bekor qildi — jim

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path not in ("/health", "/klines", "/tick"):
            try:
                ctype, body, _ = proxy_site(u.path)
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self._send(502, {"error": f"sayt yuklanmadi: {e}"})
            return
        try:
            with lock:
                if mt5.terminal_info() is None and not connect(ARGS.path, quiet=True):
                    return self._send(503, {"ok": False, "error": "MT5 ulanmagan"})
                if u.path == "/health":
                    refresh_account()
                    detect_offset()
                    return self._send(200, {
                        "ok": True, "version": VERSION, "symbol": state["symbol"], "broker": state["broker"],
                        "server": state["server"], "offsetSec": state["offset"],
                    })
                if u.path == "/klines":
                    tf = q.get("interval", "15m")
                    if tf not in TF:
                        return self._send(400, {"error": "interval"})
                    return self._send(200, rates(tf, int(q.get("limit", "1000"))))
                if u.path == "/tick":
                    t = tick()
                    if not t or not t["bid"]:
                        refresh_account()
                        t = tick()
                    return self._send(200 if t else 503, t or {"error": "tick yo'q"})
        except Exception as e:  # pragma: no cover
            self._send(500, {"error": str(e)})


def main():
    global ARGS
    p = argparse.ArgumentParser(description="AURUM MT5 ko'prigi")
    p.add_argument("--symbol", help="Oltin simvoli (masalan XAUUSDm). Ko'rsatilmasa avtomatik topiladi.")
    p.add_argument("--port", type=int, default=PORT)
    p.add_argument("--path", help="terminal64.exe yo'li (bir nechta MT5 o'rnatilgan bo'lsa)")
    p.add_argument("--no-browser", action="store_true", help="Saytni avtomatik ochmaslik")
    p.add_argument("--tz", type=float, help="Server vaqti farqi soatda (masalan 0 yoki 2). Odatda shart emas.")
    ARGS = p.parse_args()

    print("=" * 56)
    print(f"  AURUM · MT5 ko'prigi v{VERSION}")
    print("=" * 56)
    while not connect(ARGS.path):
        time.sleep(5.2)
    sym = pick_symbol(ARGS.symbol)
    if not sym:
        log("Oltin simvoli topilmadi. MT5 'Kotirovkalar' oynasida oltin nomini ko'ring va --symbol bilan bering.")
        input("Chiqish uchun Enter...")
        sys.exit(1)
    state["symbol"] = sym
    if ARGS.tz is not None:
        state["offset"] = int(ARGS.tz * 3600)
        state["offset_fixed"] = True
    detect_offset()
    t = tick()
    log(f"Simvol: {sym} · Bid {t['bid'] if t else '—'} · Ask {t['ask'] if t else '—'}")
    srv = ThreadingHTTPServer(("127.0.0.1", ARGS.port), H)
    log(f"Tayyor! Saytni shu manzilda oching: http://127.0.0.1:{ARGS.port}  (Broker rejimi avtomatik yoqiladi)")
    if not ARGS.no_browser:
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{ARGS.port}/")
    log("Bu oynani yopmang. To'xtatish uchun Ctrl+C.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        mt5.shutdown()


ARGS = None
if __name__ == "__main__":
    main()
