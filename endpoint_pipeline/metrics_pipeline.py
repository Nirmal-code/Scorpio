

from evaluator_module.metric_evaluator import MetricEvaluator
from endpoint_pipeline.portfolio_pipeline import PortfolioPipeline


class MetricPipeline:
    def __init__(self):
        self.evaluator = MetricEvaluator()
        self.portfolio = PortfolioPipeline()

    def run(self):
        profile = self.portfolio.load_portfolio()
        tickers = list(profile.get("portfolio", {}).get("holdings", {}).keys())

        evaluated_metrics = self.evaluator.get_evaluated_metrics(tickers)
        return evaluated_metrics
