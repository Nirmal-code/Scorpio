

from evaluator_module.news_evaluator import NewsEvaluator


class NewsPipeline:
    def __init__(self):
        self.evaluator = NewsEvaluator()

    def run(self, tickers):
        evaluated_news = self.evaluator.evaluate_news_relevance(tickers)
        return evaluated_news