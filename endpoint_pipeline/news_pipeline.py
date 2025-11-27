

from data_loader.news_fetcher import NewsFetcher
from evaluator_module.news_evaluator import NewsEvaluator


class NewsPipeline:
    def __init__(self):
        self.evaluator = NewsEvaluator()
        self.fetcher = NewsFetcher()

    def run(self, tickers):
        news = self.fetcher.get_relevant_news_articles(tickers)
        # evaluated_news = self.evaluator.evaluate_news_relevance(tickers)
        return news