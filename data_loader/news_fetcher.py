from dotenv import load_dotenv
import requests
import os


BASE_URL = "https://financialmodelingprep.com/stable/fmp-articles?page=0"

load_dotenv()

API_KEY = os.getenv("API_KEY")


class NewsFetcher: 
    def __init__(self):
        self.news_articles = {}
    
    def get_latest_news(self, limit=20):
        url = f"{BASE_URL}&limit={limit}&apikey={API_KEY}"
        response = requests.get(url)
        if response.status_code == 200:
            return response.json()
        return []
    
    def get_relevant_news_articles(self, tickers, limit=20):
        articles = self.get_latest_news(limit=limit)

        if not tickers:
            self.news_articles = articles
            return articles

        normalized = [str(t).strip().upper() for t in tickers if str(t).strip()]
        relevant_by_ticker = {}

        for article in articles:
            if not isinstance(article, dict):
                continue

            title = article.get("title", "")
            content = article.get("text", "") or article.get("content", "") or ""
            article_ticker = article.get("tickers", "")
            combined = f"{title} {content}".upper()

            for ticker in normalized:
                if ticker and ticker in article_ticker:
                    relevant_by_ticker.setdefault(ticker, []).append(combined)

        self.news_articles = relevant_by_ticker
        return relevant_by_ticker
    
    def print_relevant_news(self):
        for ticker, articles in self.news_articles.items():
            print(f"\nTicker: {ticker} - {len(articles)} articles found:")
            for article in articles:
                print(f"- {article[:100]}...")
