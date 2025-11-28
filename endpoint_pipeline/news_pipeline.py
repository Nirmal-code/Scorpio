

from data_loader.news_fetcher import NewsFetcher


class NewsPipeline:
    def __init__(self):
        self.fetcher = NewsFetcher()

    def run(self, tickers):
        news = self.fetcher.get_relevant_news_articles(tickers)
        return news