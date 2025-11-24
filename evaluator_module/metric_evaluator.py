import datetime

import numpy as np
import pandas as pd

import data_loader.metrics_fetcher as mf


class MetricEvaluator:
    def __init__(self):
        self.evaluated_metrics = {}
        self.fetcher = mf.MetricFetcher()

    def get_evaluated_metrics(self, tickers):
        df_metrics, latest_metrics = self.fetcher.get_updated_metrics(tickers)

        for ticker in df_metrics.keys():
            latest = latest_metrics[ticker]
            latest_serializable = self._serialize_latest(latest)
            df = df_metrics[ticker]
            evaluation = self.evaluate_metrics(latest, df)
            self.evaluated_metrics[ticker] = {
                'evaluation': evaluation,
                'latest': latest_serializable
            }

        return self.evaluated_metrics

    def evaluate_metrics(self, latest, df):
        buy = 0
        sell = 0
        hold = 0

        # BUY SIGNALS (positive)

        # Oversold RSI (<30)
        if latest["rsi"] < 30:
            buy += 2
        if latest["rsi"] < 20:
            buy += 2  # extreme oversold

        # MACD bullish crossover
        if latest["macd_cross_up"]:
            buy += 3

        # Price above long-term trend (MA200)
        if latest["Close"] > latest["ma200"]:
            buy += 1

        # Reversal attempt: price recovering after down streak
        if latest["pct_change"] > 0.03 and latest["rsi"] < 40:
            buy += 1

        # SELL SIGNALS (negative)

        # Overbought RSI (>70)
        if latest["rsi"] > 70:
            sell += 2
        if latest["rsi"] > 80:
            sell += 2

        # MACD bearish crossover
        if latest["macd_cross_down"]:
            sell += 3

        # Price below MA200 → long-term weakness
        if latest["Close"] < latest["ma200"]:
            sell += 2

        # Large downward move
        if latest["pct_change"] < -0.03 and latest["rsi"] > 60:
            sell += 1

        # Underperforming SPY recently
        rs_mean = df['rel_strength'].rolling(20).mean().iloc[-1]
        if latest["rel_strength"] < rs_mean:
            sell += 1

        # High volatility + falling price
        atr_mean = df["atr"].rolling(50).mean().iloc[-1]
        if latest["atr"] > atr_mean and latest["pct_change"] < 0:
            sell += 1

        # HOLD SIGNALS (neutral or mixed)

        # No significant signals
        if 30 <= latest["rsi"] <= 70:
            hold += 1

        # Price near MA200 (uncertain territory)
        if abs(latest["Close"] - latest["ma200"]) / latest["ma200"] < 0.03:
            hold += 1

        # No MACD crossover (trend undecided)
        if not latest["macd_cross_up"] and not latest["macd_cross_down"]:
            hold += 1

        # NORMALIZE TO CONFIDENCE LEVELS
        total = buy + hold + sell
        if total == 0:
            total = 1  # avoid division by zero

        return {
            "BUY": round(buy / total, 4),
            "HOLD": round(hold / total, 4),
            "SELL": round(sell / total, 4)
        }

    def _serialize_latest(self, latest):
        """Convert pandas/NumPy values to plain Python types for JSON responses."""
        def _convert(value):
            if isinstance(value, (np.generic,)):
                return value.item()
            if isinstance(value, (pd.Timestamp, datetime.datetime, datetime.date)):
                return value.isoformat()
            if pd.isna(value):
                return None
            return value

        return {k: _convert(v) for k, v in latest.to_dict().items()}
    
    def print_evaluated_metrics(self):
        print("\n===== Evaluated Metrics =====")
        for ticker, data in self.evaluated_metrics.items():
            print(f"\n--- {ticker} ---")
            
            evaluation = data.get("evaluation")
            latest = data.get("latest")
            
            print("Latest Metrics:")
            for k, v in latest.items():
                print(f"  {k}: {v}")

            print("\nEvaluation:")
            if isinstance(evaluation, dict):
                for k, v in evaluation.items():
                    print(f"  {k}: {v}")
            else:
                print(f"  {evaluation}")
