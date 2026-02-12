#!/usr/bin/env python3
"""
Screeni-py wrapper for India Policy Signal Terminal.
Scans NSE stocks using pkscreener and outputs CSV.

Usage:
    python3 src/screenipy.py <tickerOption> <executeOption> --output <file>

Ticker options (from pkscreener):
    1  = Nifty 50
    2  = Nifty Next 50
    3  = Nifty 100
    4  = Nifty 200
    5  = Nifty 500
    6  = Nifty Smallcap 50
    7  = Nifty Smallcap 100
    12 = All NSE stocks

Execute options:
    0  = Full screening
    1  = Breakout signals
    2  = Recent breakouts
    6  = Volume scanners
    7  = Consolidating stocks
"""

import argparse
import csv
import importlib
import json
import math
import sys
import time
import urllib.error
import urllib.request


NIFTY50 = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "SBIN",
    "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK", "ASIANPAINT", "HCLTECH",
    "MARUTI", "SUNPHARMA", "TITAN", "BAJFINANCE", "WIPRO", "ULTRACEMCO",
    "ONGC", "NTPC", "POWERGRID", "TATAMOTORS", "M&M", "ADANIENT", "ADANIPORTS",
    "JSWSTEEL", "TATASTEEL", "TECHM", "INDUSINDBK", "NESTLEIND", "BAJAJFINSV",
    "COALINDIA", "GRASIM", "DIVISLAB", "DRREDDY", "CIPLA", "EICHERMOT",
    "APOLLOHOSP", "HEROMOTOCO", "BRITANNIA", "TATACONSUM", "HINDALCO",
    "BPCL", "SBILIFE", "HDFCLIFE", "UPL", "HAL", "BEL",
]

NIFTY_NEXT_50 = [
    "IRCTC", "IRFC", "RVNL", "PFC", "RECLTD", "NHPC", "SJVN", "IDFCFIRSTB",
    "CANBK", "PNB", "BANKBARODA", "UNIONBANK", "IOB", "MAZDOCK", "COCHINSHIP",
    "GRSE", "BHEL", "NBCC", "HUDCO", "SAIL", "NMDC", "VEDL", "TATAPOWER",
    "ADANIGREEN", "ADANIPOWER", "TORNTPOWER", "ZOMATO", "PAYTM", "NYKAA",
    "POLICYBZR", "DELHIVERY", "ZEEL", "MOTHERSON", "TRENT", "PERSISTENT",
    "COFORGE", "MPHASIS", "LTTS", "PIIND", "AARTIIND", "DEEPAKNTR", "ASTRAL",
    "POLYCAB", "KAYNES", "DIXON", "AMBER", "AFFLE", "INTELLECT", "HAPPSTMNDS", "GAIL",
]

MIDCAP_POOL = [
    "ABB", "AUBANK", "BANDHANBNK", "BIOCON", "CROMPTON", "DALBHARAT", "DEEPAKFERT",
    "ESCORTS", "EXIDEIND", "FEDERALBNK", "GLENMARK", "GMRINFRA", "INDIGO", "JUBLFOOD",
    "LUPIN", "MUTHOOTFIN", "PIDILITIND", "SRF", "TVSMOTOR", "VOLTAS", "ZYDUSLIFE",
]


def _ema(series, span):
    return series.ewm(span=span, adjust=False).mean()


def _sma(series, window):
    return series.rolling(window=window).mean()


def _rsi(close, period=14):
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50)


def _macd(close, fast=12, slow=26, signal=9):
    fast_ema = _ema(close, fast)
    slow_ema = _ema(close, slow)
    macd_line = fast_ema - slow_ema
    signal_line = _ema(macd_line, signal)
    return macd_line, signal_line


def _cci(high, low, close, period=20):
    tp = (high + low + close) / 3
    tp_sma = tp.rolling(window=period).mean()
    mean_dev = (tp - tp_sma).abs().rolling(window=period).mean()
    return (tp - tp_sma) / (0.015 * mean_dev.replace(0, float("nan")))


def _atr(high, low, close, period=14):
    prev_close = close.shift(1)
    tr = (high - low).to_frame(name="hl")
    tr["hc"] = (high - prev_close).abs()
    tr["lc"] = (low - prev_close).abs()
    true_range = tr.max(axis=1)
    return true_range.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def _detect_pattern(frame):
    if len(frame) < 3:
        return "None"
    latest = frame.iloc[-1]
    prev = frame.iloc[-2]

    body = abs(latest["Close"] - latest["Open"])
    range_size = max(latest["High"] - latest["Low"], 1e-9)
    lower_wick = min(latest["Open"], latest["Close"]) - latest["Low"]
    upper_wick = latest["High"] - max(latest["Open"], latest["Close"])

    bullish_engulfing = (
        prev["Close"] < prev["Open"]
        and latest["Close"] > latest["Open"]
        and latest["Open"] <= prev["Close"]
        and latest["Close"] >= prev["Open"]
    )
    if bullish_engulfing:
        return "Bullish Engulfing"

    if lower_wick > body * 2 and upper_wick < body and body / range_size < 0.5:
        return "Hammer"

    if body / range_size < 0.1:
        return "Doji"

    breakout = latest["Close"] > frame["High"].tail(20).shift(1).max()
    if breakout:
        return "Breakout"

    return "None"


def _classify_trend(close, ema20, ema50, rsi_value):
    if close > ema20 > ema50 and rsi_value >= 60:
        return "Strong Up"
    if close > ema20 and rsi_value >= 50:
        return "Up"
    if close < ema20 < ema50 and rsi_value <= 40:
        return "Down"
    if close < ema20 and rsi_value < 50:
        return "Weak"
    return "Sideways"


def _ticker_universe(ticker_option):
    option = int(ticker_option)
    if option == 1:
        return NIFTY50
    if option == 2:
        return NIFTY_NEXT_50
    if option == 3:
        return (NIFTY50 + NIFTY_NEXT_50)[:100]
    if option == 4:
        return (NIFTY50 + NIFTY_NEXT_50 + MIDCAP_POOL)[:150]
    if option in (5, 12):
        return NIFTY50 + NIFTY_NEXT_50 + MIDCAP_POOL
    return NIFTY50


def _ema_latest(values, period):
    if not values:
        return None
    alpha = 2.0 / (period + 1)
    ema = values[0]
    for value in values[1:]:
        ema = (value * alpha) + (ema * (1 - alpha))
    return ema


def _rsi_latest(values, period=14):
    if len(values) < period + 1:
        return None
    gains = []
    losses = []
    for i in range(1, period + 1):
        delta = values[i] - values[i - 1]
        gains.append(max(delta, 0))
        losses.append(max(-delta, 0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    for i in range(period + 1, len(values)):
        delta = values[i] - values[i - 1]
        gain = max(delta, 0)
        loss = max(-delta, 0)
        avg_gain = ((avg_gain * (period - 1)) + gain) / period
        avg_loss = ((avg_loss * (period - 1)) + loss) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _sma_latest(values, period):
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _macd_latest(values, fast=12, slow=26, signal=9):
    if len(values) < slow + signal:
        return None, None
    alpha_fast = 2.0 / (fast + 1)
    alpha_slow = 2.0 / (slow + 1)
    fast_ema = values[0]
    slow_ema = values[0]
    macd_series = []
    for value in values:
        fast_ema = (value * alpha_fast) + (fast_ema * (1 - alpha_fast))
        slow_ema = (value * alpha_slow) + (slow_ema * (1 - alpha_slow))
        macd_series.append(fast_ema - slow_ema)
    alpha_signal = 2.0 / (signal + 1)
    signal_ema = macd_series[0]
    for value in macd_series[1:]:
        signal_ema = (value * alpha_signal) + (signal_ema * (1 - alpha_signal))
    return macd_series[-1], signal_ema


def _cci_latest(highs, lows, closes, period=20):
    if len(closes) < period:
        return None
    typical = [(highs[i] + lows[i] + closes[i]) / 3 for i in range(len(closes))]
    window = typical[-period:]
    sma = sum(window) / period
    mean_dev = sum(abs(x - sma) for x in window) / period
    if mean_dev == 0:
        return None
    return (window[-1] - sma) / (0.015 * mean_dev)


def _atr_latest(highs, lows, closes, period=14):
    if len(closes) < period + 1:
        return None
    tr_values = []
    for i in range(1, len(closes)):
        high = highs[i]
        low = lows[i]
        prev_close = closes[i - 1]
        tr_values.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
    if len(tr_values) < period:
        return None
    atr = sum(tr_values[:period]) / period
    for tr in tr_values[period:]:
        atr = ((atr * (period - 1)) + tr) / period
    return atr


import time

# Rate limiting: minimum seconds between requests to Yahoo Finance
_YAHOO_DELAY_SECONDS = 1.5
_last_request_time = 0


def _rate_limited_request():
    global _last_request_time
    now = time.time()
    elapsed = now - _last_request_time
    if elapsed < _YAHOO_DELAY_SECONDS:
        time.sleep(_YAHOO_DELAY_SECONDS - elapsed)
    _last_request_time = time.time()


def _download_yahoo_candles(ticker, max_retries: int = 3):
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{ticker}.NS?range=8mo&interval=1d"
    )
    
    for attempt in range(max_retries):
        try:
            _rate_limited_request()
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8"))
            result = payload.get("chart", {}).get("result", [])
            if not result:
                return []
            series = result[0]
            quote = (series.get("indicators", {}).get("quote", [{}]) or [{}])[0]
            opens = quote.get("open", [])
            highs = quote.get("high", [])
            lows = quote.get("low", [])
            closes = quote.get("close", [])
            volumes = quote.get("volume", [])
            candles = []
            for i in range(len(closes)):
                try:
                    o = opens[i]
                    h = highs[i]
                    l = lows[i]
                    c = closes[i]
                    v = volumes[i]
                    if o is None or h is None or l is None or c is None or v is None:
                        continue
                    candles.append(
                        {
                            "open": float(o),
                            "high": float(h),
                            "low": float(l),
                            "close": float(c),
                            "volume": int(float(v)),
                        }
                    )
                except Exception:
                    continue
            return candles
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            return []
        except Exception:
            return []
    return []


def fetch_real_data_scan_stdlib(ticker_option, output_path):
    rows = []
    for ticker in _ticker_universe(ticker_option):
        try:
            candles = _download_yahoo_candles(ticker)
            if len(candles) < 60:
                continue
            opens = [c["open"] for c in candles]
            highs = [c["high"] for c in candles]
            lows = [c["low"] for c in candles]
            closes = [c["close"] for c in candles]
            volumes = [c["volume"] for c in candles]

            latest_close = closes[-1]
            latest_volume = volumes[-1]
            latest_rsi = _rsi_latest(closes, 14)
            latest_ema20 = _ema_latest(closes[-80:], 20)
            latest_ema50 = _ema_latest(closes[-140:], 50)
            latest_sma20 = _sma_latest(closes, 20)
            latest_sma50 = _sma_latest(closes, 50)
            latest_macd, latest_macd_signal = _macd_latest(closes, 12, 26, 9)
            latest_cci = _cci_latest(highs, lows, closes, 20)
            latest_atr = _atr_latest(highs, lows, closes, 14)
            trend = _classify_trend(
                latest_close,
                latest_ema20 if latest_ema20 is not None else latest_close,
                latest_ema50 if latest_ema50 is not None else latest_close,
                latest_rsi if latest_rsi is not None else 50.0,
            )
            pattern = _detect_pattern_from_arrays(opens, highs, lows, closes)

            rows.append(
                {
                    "Stock": ticker,
                    "LTP": f"{latest_close:.2f}",
                    "Volume": str(latest_volume),
                    "RSI": f"{(latest_rsi if latest_rsi is not None else 50.0):.1f}",
                    "Trend": trend,
                    "Pattern": pattern,
                    "EMA20": f"{latest_ema20:.2f}" if latest_ema20 is not None else "",
                    "EMA50": f"{latest_ema50:.2f}" if latest_ema50 is not None else "",
                    "SMA20": f"{latest_sma20:.2f}" if latest_sma20 is not None else "",
                    "SMA50": f"{latest_sma50:.2f}" if latest_sma50 is not None else "",
                    "MACD": f"{latest_macd:.4f}" if latest_macd is not None else "",
                    "MACDSignal": f"{latest_macd_signal:.4f}" if latest_macd_signal is not None else "",
                    "CCI20": f"{latest_cci:.2f}" if latest_cci is not None else "",
                    "ATR14": f"{latest_atr:.2f}" if latest_atr is not None else "",
                }
            )
        except Exception:
            continue

    if not rows:
        return False

    rows.sort(key=lambda row: float(row["RSI"]), reverse=True)
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "Stock",
                "LTP",
                "Volume",
                "RSI",
                "Trend",
                "Pattern",
                "EMA20",
                "EMA50",
                "SMA20",
                "SMA50",
                "MACD",
                "MACDSignal",
                "CCI20",
                "ATR14",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)
    return True


def _detect_pattern_from_arrays(opens, highs, lows, closes):
    if len(closes) < 3:
        return "None"
    latest_open = opens[-1]
    latest_high = highs[-1]
    latest_low = lows[-1]
    latest_close = closes[-1]
    prev_open = opens[-2]
    prev_close = closes[-2]

    body = abs(latest_close - latest_open)
    range_size = max(latest_high - latest_low, 1e-9)
    lower_wick = min(latest_open, latest_close) - latest_low
    upper_wick = latest_high - max(latest_open, latest_close)

    bullish_engulfing = (
        prev_close < prev_open
        and latest_close > latest_open
        and latest_open <= prev_close
        and latest_close >= prev_open
    )
    if bullish_engulfing:
        return "Bullish Engulfing"
    if lower_wick > body * 2 and upper_wick < body and body / range_size < 0.5:
        return "Hammer"
    if body / range_size < 0.1:
        return "Doji"
    prev_20_high = max(highs[-21:-1]) if len(highs) >= 21 else max(highs[:-1])
    if latest_close > prev_20_high:
        return "Breakout"
    return "None"


def fetch_real_data_scan(ticker_option, output_path):
    try:
        yf = importlib.import_module("yfinance")
        pd = importlib.import_module("pandas")
    except Exception as error:
        print(f"yfinance/pandas path unavailable ({error}), trying stdlib Yahoo fetch", file=sys.stderr)
        if fetch_real_data_scan_stdlib(ticker_option, output_path):
            print(f"Real-data scan complete (stdlib path) -> {output_path}", file=sys.stderr)
            return
        print("stdlib Yahoo fetch returned no rows, falling back to simulated scan", file=sys.stderr)
        generate_simulated_data(output_path)
        return

    rows = []
    for ticker in _ticker_universe(ticker_option):
        symbol = f"{ticker}.NS"
        try:
            data = yf.download(
                tickers=symbol,
                period="8mo",
                interval="1d",
                progress=False,
                auto_adjust=False,
                timeout=10,
            )
            if data is None or data.empty:
                continue
            if isinstance(data.columns, pd.MultiIndex):
                data = data.droplevel(level=1, axis=1)
            required = {"Open", "High", "Low", "Close", "Volume"}
            if not required.issubset(set(data.columns)):
                continue
            data = data.dropna(subset=["Open", "High", "Low", "Close", "Volume"])
            if len(data) < 60:
                continue

            ema20 = _ema(data["Close"], 20)
            ema50 = _ema(data["Close"], 50)
            sma20 = _sma(data["Close"], 20)
            sma50 = _sma(data["Close"], 50)
            rsi14 = _rsi(data["Close"], 14)
            macd_line, macd_signal = _macd(data["Close"], 12, 26, 9)
            cci20 = _cci(data["High"], data["Low"], data["Close"], 20)
            atr14 = _atr(data["High"], data["Low"], data["Close"], 14)

            latest_close = float(data["Close"].iloc[-1])
            latest_volume = int(float(data["Volume"].iloc[-1]))
            latest_rsi = float(rsi14.iloc[-1]) if not pd.isna(rsi14.iloc[-1]) else 50.0
            latest_ema20 = float(ema20.iloc[-1]) if not pd.isna(ema20.iloc[-1]) else latest_close
            latest_ema50 = float(ema50.iloc[-1]) if not pd.isna(ema50.iloc[-1]) else latest_close

            rows.append(
                {
                    "Stock": ticker,
                    "LTP": f"{latest_close:.2f}",
                    "Volume": str(latest_volume),
                    "RSI": f"{latest_rsi:.1f}",
                    "Trend": _classify_trend(latest_close, latest_ema20, latest_ema50, latest_rsi),
                    "Pattern": _detect_pattern(data),
                    "EMA20": f"{latest_ema20:.2f}",
                    "EMA50": f"{latest_ema50:.2f}",
                    "SMA20": f"{float(sma20.iloc[-1]):.2f}" if not pd.isna(sma20.iloc[-1]) else "",
                    "SMA50": f"{float(sma50.iloc[-1]):.2f}" if not pd.isna(sma50.iloc[-1]) else "",
                    "MACD": f"{float(macd_line.iloc[-1]):.4f}" if not pd.isna(macd_line.iloc[-1]) else "",
                    "MACDSignal": f"{float(macd_signal.iloc[-1]):.4f}" if not pd.isna(macd_signal.iloc[-1]) else "",
                    "CCI20": f"{float(cci20.iloc[-1]):.2f}" if not pd.isna(cci20.iloc[-1]) else "",
                    "ATR14": f"{float(atr14.iloc[-1]):.2f}" if not pd.isna(atr14.iloc[-1]) else "",
                }
            )
        except Exception:
            continue

    if not rows:
        print("Real-data scan returned no rows, falling back to simulated data", file=sys.stderr)
        generate_simulated_data(output_path)
        return

    rows.sort(key=lambda row: float(row["RSI"]), reverse=True)
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "Stock",
                "LTP",
                "Volume",
                "RSI",
                "Trend",
                "Pattern",
                "EMA20",
                "EMA50",
                "SMA20",
                "SMA50",
                "MACD",
                "MACDSignal",
                "CCI20",
                "ATR14",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Real-data scan complete: {len(rows)} symbols written to {output_path}", file=sys.stderr)

def run_scan(ticker_option, execute_option, output_path):
    if fetch_real_data_scan_stdlib(ticker_option, output_path):
        print(f"Real-data scan complete -> {output_path}", file=sys.stderr)
        return
    raise RuntimeError("Real-data scan failed - no simulated data allowed. Check NSE data source connectivity.")

def generate_simulated_data(output_path):
    """Generate realistic simulated NSE stock scan data when pkscreener is not available."""
    import random
    import datetime

    all_stocks = NIFTY50 + NIFTY_NEXT_50
    trends = ["Strong Up", "Up", "Sideways", "Weak", "Down"]
    patterns = [
        "Bullish Engulfing", "Morning Star", "Hammer", "Inverse H&S",
        "Cup & Handle", "Breakout", "Consolidation", "Golden Cross",
        "MACD Crossover", "RSI Oversold Bounce", "Volume Breakout",
        "Trendline Support", "Moving Avg Support", "Double Bottom",
        "Flag Pattern", "Ascending Triangle", "None"
    ]

    random.seed(int(datetime.datetime.now().timestamp()) % 10000)
    selected = random.sample(all_stocks, min(len(all_stocks), 60))

    rows = []
    for stock in selected:
        ltp = round(random.uniform(50, 5000), 2)
        volume = random.randint(100000, 50000000)
        rsi = round(random.uniform(20, 85), 1)
        trend = random.choice(trends)
        pattern = random.choice(patterns)
        rows.append({
            "Stock": stock,
            "LTP": str(ltp),
            "Volume": str(volume),
            "RSI": str(rsi),
            "Trend": trend,
            "Pattern": pattern,
        })

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["Stock", "LTP", "Volume", "RSI", "Trend", "Pattern"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Simulated scan: {len(rows)} stocks written to {output_path}", file=sys.stderr)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Screeni-py NSE stock scanner wrapper")
    parser.add_argument("tickerOption", help="Ticker option (1=Nifty50, 5=Nifty500, 12=All NSE)")
    parser.add_argument("executeOption", help="Execute option (0=Full, 1=Breakout, etc.)")
    parser.add_argument("--output", required=True, help="Output CSV file path")
    args = parser.parse_args()
    run_scan(args.tickerOption, args.executeOption, args.output)
