

from data_loader.news_fetcher import NewsFetcher
from endpoint_pipeline.portfolio_pipeline import PortfolioPipeline


class NewsPipeline:
    def __init__(self):
        self.fetcher = NewsFetcher()
        self.portfolio = PortfolioPipeline()

    def run(self):
        profile = self.portfolio.load_portfolio()
        tickers = list(profile.get("portfolio", {}).get("holdings", {}).keys())

        news = self.fetcher.get_relevant_news_articles(tickers)
        return news