from datetime import date
from dotenv import load_dotenv
import requests
import os


BASE_URL = "https://api.massive.com/v2/reference/news?order=asc&limit=20&sort=published_utc"

load_dotenv()

API_KEY = os.getenv("MASSIVE_API_KEY")


class NewsFetcher: 
    def __init__(self):
        self.news_articles = {}
    
    def get_latest_news(self, ticker, limit=20):
        today_str = date.today().strftime("%Y-%m-%d")
        url = f"https://api.massive.com/v2/reference/news?ticker={ticker}&published_utc={today_str}&order=asc&limit={limit}&sort=published_utc&apiKey={API_KEY}"
        response = requests.get(url)
        if response.status_code == 200:
            return response.json()
        return []
    
    def get_relevant_news_articles(self, tickers, limit=20):
        for ticker in tickers:
            articles = self.get_latest_news(limit=limit, ticker=ticker)
            if (len(articles) == 0):
                continue
            all_insights = []
            for article in articles.get("results", []):
                if not isinstance(article, dict):
                    continue

                insights = article.get("insights", "")
                stock_insight = ""
                for insight in insights:
                    if insight.get("ticker", "") == ticker:
                        stock_insight = insight
                        break

                all_insights.append({
                    "title": article.get("title", ""),
                    "sentiment": stock_insight.get("sentiment", ""),
                    "insight": stock_insight.get("sentiment_reasoning", "")})
                
            self.news_articles[ticker] = all_insights
        self.print_relevant_news()
        return self.news_articles
    
    def print_relevant_news(self):
        for ticker, articles in self.news_articles.items():
            print(f"\nTicker: {ticker} - {len(articles)} articles found:")
            
            for article in articles:
                title = article.get("title", "No title")
                insight = article.get("insight", "No insight")
                sentiment = article.get("sentiment", "No sentiment")
                
                print("\n--- News Article ---")
                print(f"Title: {title}")
                print(f"Insight: {insight}")
                print(f"Sentiment: {sentiment}")

                
                print("---------------------")
