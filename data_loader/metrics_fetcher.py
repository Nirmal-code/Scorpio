import yfinance as yf
import pandas as pd
import numpy as np
import datetime

class MetricFetcher:
    def __init__(self):
        self.df_metrics = {}
        self.latest_metrics = {}
        self.signals = {}

    
    def get_updated_metrics(self, tickers):
        for ticker in tickers:
            self.fetch_metrics(ticker)
        return self.df_metrics, self.latest_metrics


    def fetch_metrics(self, ticker=None):
        df = yf.download(ticker, period="1y", progress=False, auto_adjust=True)

        df.columns = df.columns.get_level_values(0)

        df = df.reset_index(drop=True)

        # BASIC INDICATORS
        df['pct_change'] = df['Close'].pct_change()

        df['ma50'] = df['Close'].rolling(50).mean()
        df['ma200'] = df['Close'].rolling(200).mean()

        df['avg_volume_20'] = df['Volume'].rolling(20).mean()

        # Avoid alignment issues: convert to numpy
        df['unusual_volume'] = df['Volume'].to_numpy() > (2 * df['avg_volume_20'].to_numpy())

        df['52w_high'] = df['Close'].to_numpy() >= df['Close'].rolling(252).max().to_numpy()
        df['52w_low']  = df['Close'].to_numpy() <= df['Close'].rolling(252).min().to_numpy()

        # -----------------------------
        # RSI (14-day)
        # -----------------------------
        delta = df['Close'].diff()
        gain = np.where(delta > 0, delta, 0)
        loss = np.where(delta < 0, -delta, 0)

        roll_up = pd.Series(gain).rolling(14).mean()
        roll_down = pd.Series(loss).rolling(14).mean()

        rs = roll_up / roll_down
        df['rsi'] = 100 - (100 / (1 + rs))

        # -----------------------------
        # MACD (12/26 EMA + 9 EMA signal)
        # -----------------------------
        exp12 = df['Close'].ewm(span=12, adjust=False).mean()
        exp26 = df['Close'].ewm(span=26, adjust=False).mean()

        df['macd'] = exp12 - exp26
        df['macd_signal'] = df['macd'].ewm(span=9, adjust=False).mean()
        df['macd_cross_up'] = (df['macd'] > df['macd_signal']) & (df['macd'].shift(1) <= df['macd_signal'].shift(1))
        df['macd_cross_down'] = (df['macd'] < df['macd_signal']) & (df['macd'].shift(1) >= df['macd_signal'].shift(1))

        # -----------------------------
        # ATR (Volatility)
        # -----------------------------
        high_low = df['High'] - df['Low']
        high_close = np.abs(df['High'] - df['Close'].shift(1))
        low_close = np.abs(df['Low'] - df['Close'].shift(1))

        tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
        df['atr'] = tr.rolling(14).mean()

        # -----------------------------
        # RELATIVE STRENGTH VS SPY
        # -----------------------------
        spy = yf.download("SPY", period="1y", progress=False, auto_adjust=True)
        spy.columns = spy.columns.get_level_values(0)
        spy = spy.reset_index(drop=True)

        min_len = min(len(df), len(spy))
        df = df.iloc[:min_len]
        spy = spy.iloc[:min_len]

        df['rel_strength'] = df['Close'] / spy['Close']


        # -----------------------------
        # EARNINGS PROXIMITY
        # -----------------------------
        t = yf.Ticker(ticker)
        try:
            cal = t.calendar
            earnings_date = cal.loc["Earnings Date"][0].to_pydatetime()
            days_to_earnings = (earnings_date - datetime.now()).days
        except:
            days_to_earnings = None

        # -----------------------------
        # FINAL SIGNAL EXTRACTION
        # -----------------------------
        latest = df.iloc[-1]
        signals = []

        # Price movement
        if latest['pct_change'] > 0.03:
            signals.append("Large upward daily move (>3%)")
        if latest['pct_change'] < -0.03:
            signals.append("Large downward daily move (<-3%)")

        # Volume signal
        if latest['unusual_volume']:
            signals.append("Unusual volume (>2x 20-day avg)")

        # 52-week levels
        if latest['52w_high']:
            signals.append("New 52-week high")
        if latest['52w_low']:
            signals.append("New 52-week low")

        # Trend signals
        if latest['Close'] > latest['ma50']:
            signals.append("Price above 50-day MA")
        if latest['Close'] > latest['ma200']:
            signals.append("Price above 200-day MA")
        if latest['Close'] < latest['ma200']:
            signals.append("Price below 200-day MA (long-term weakness)")

        # RSI
        if latest['rsi'] > 70:
            signals.append("Overbought (RSI > 70)")
        elif latest['rsi'] < 30:
            signals.append("Oversold (RSI < 30)")

        # MACD crossovers
        if latest['macd_cross_up']:
            signals.append("MACD bullish crossover")
        if latest['macd_cross_down']:
            signals.append("MACD bearish crossover")

        # Volatility
        if latest['atr'] > df['atr'].rolling(50).mean().iloc[-1]:
            signals.append("High volatility regime (ATR elevated)")

        # Relative strength
        if latest['rel_strength'] > df['rel_strength'].rolling(20).mean().iloc[-1]:
            signals.append("Outperforming SPY recently")
        else:
            signals.append("Underperforming SPY recently")

        # Earnings warnings
        if days_to_earnings is not None:
            if 0 < days_to_earnings <= 7:
                signals.append("Earnings in <7 days — expect volatility")
            elif 7 < days_to_earnings <= 14:
                signals.append("Earnings in <14 days")
            elif days_to_earnings == 0:
                signals.append("Earnings today")

        self.df_metrics[ticker] = df
        self.latest_metrics[ticker] = latest
        self.signals[ticker] = signals


if __name__ == "__main__":
    print("Updating all signals...")
    MetricFetcherInstance = MetricFetcher()
    MetricFetcherInstance.get_updated_metrics()
