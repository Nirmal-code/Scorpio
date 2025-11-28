import json
from pathlib import Path
from data_loader.news_fetcher import NewsFetcher
from evaluator_module.ai_evaluator import AIEvaluator
from evaluator_module.metric_evaluator import MetricEvaluator


class ModelPipeline:
    def __init__(self):
        self.evaluator = AIEvaluator()
        self.news_fetcher = NewsFetcher()
        self.metric_fetcher = MetricEvaluator()

    def run(self, tickers):
        profile_path = Path(__file__).parent / ".." / "investment_data" / "profile.json"
        with profile_path.open() as f:
            profile = json.load(f)
        news = self.news_fetcher.get_relevant_news_articles(tickers)
        metrics = self.metric_fetcher.get_evaluated_metrics(tickers)
        ai_interp = self.evaluator.model_evaluation(profile=profile, news=news, metrics=metrics)
        return ai_interp