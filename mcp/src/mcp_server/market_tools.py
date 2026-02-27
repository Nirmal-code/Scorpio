from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict

import numpy as np
import yfinance as yf

# Make the project root importable so we can reuse existing metric logic
REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

from evaluator_module.metric_evaluator import MetricEvaluator

def _to_native(value: Any) -> Any:
    """Convert NumPy/pandas scalars to plain Python types for JSON safety."""
    if isinstance(value, np.generic):
        return value.item()
    return value


async def get_snapshot(ticker: str) -> str:
    """Return a quick market snapshot and technicals for a ticker."""

    evaluator = MetricEvaluator()
    evaluated = evaluator.get_evaluated_metrics([ticker])
    data = evaluated.get(ticker)
    if not data:
        raise ValueError(f"No data returned for ticker '{ticker}'")

    latest: Dict[str, Any] = data.get("latest", {})
    evaluation: Dict[str, Any] = data.get("evaluation", {})
    signals = evaluator.fetcher.signals.get(ticker, [])

    # Fundamental snapshot from yfinance
    try:
        info = yf.Ticker(ticker).info or {}
    except Exception:
        info = {}

    def pick(*keys):
        for key in keys:
            if key in info and info[key] is not None:
                return _to_native(info[key])
        return None

    snapshot = {
        "ticker": ticker.upper(),
        "price": _to_native(latest.get("Close")),
        "day_change_pct": _to_native(latest.get("pct_change")),
        "volume": _to_native(latest.get("Volume")),
        "avg_volume_20": _to_native(latest.get("avg_volume_20")),
        "market_cap": pick("marketCap"),
        "pe": pick("trailingPE", "forwardPE"),
        "eps": pick("trailingEps", "epsTrailingTwelveMonths"),
        "dividend_yield": pick("dividendYield"),
        "beta": pick("beta"),
        "rsi": _to_native(latest.get("rsi")),
        "macd": _to_native(latest.get("macd")),
        "macd_signal": _to_native(latest.get("macd_signal")),
        "macd_cross_up": _to_native(latest.get("macd_cross_up")),
        "macd_cross_down": _to_native(latest.get("macd_cross_down")),
        "atr": _to_native(latest.get("atr")),
        "ma50": _to_native(latest.get("ma50")),
        "ma200": _to_native(latest.get("ma200")),
        "rel_strength_vs_spy": _to_native(latest.get("rel_strength")),
        "signals": signals,
        "evaluation": evaluation,
    }

    # Return JSON string so MCP clients can easily parse it
    return json.dumps(snapshot, default=_to_native)