import json
from pathlib import Path
from data_loader.news_fetcher import NewsFetcher
from evaluator_module.ai_evaluator import AIEvaluator
from evaluator_module.metric_evaluator import MetricEvaluator
from endpoint_pipeline.portfolio_pipeline import PortfolioPipeline


class ModelPipeline:
    def __init__(self):
        self.evaluator = AIEvaluator()
        self.news_fetcher = NewsFetcher()
        self.metric_fetcher = MetricEvaluator()
        self.portfolio = PortfolioPipeline()

    def run(self):
        profile = self.portfolio.load_portfolio()
        tickers = list(profile.get("portfolio", {}).get("holdings", {}).keys())

        news = self.news_fetcher.get_relevant_news_articles(tickers)
        metrics = self.metric_fetcher.get_evaluated_metrics(tickers)
        ai_interp = self.evaluator.model_evaluation(profile=profile, news=news, metrics=metrics)
        return ai_interp