import json
import data_loader.news_fetcher as nf
from openai import OpenAI
import os

class NewsEvaluator:
    def __init__(self):
        self.evaluated_news = {}
        self.fetcher = nf.NewsFetcher()
        self.model = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    def evaluate_news_relevance(self, tickers):
        relevant_news = self.fetcher.get_relevant_news_articles(tickers, limit=20)
        # for ticker, articles in relevant_news.items():
        #     self.model_evaluation(ticker, articles)

        return relevant_news
    

    def model_evaluation(self, ticker, articles):

        content = json.dumps(articles)

        response = self.model.chat.completions.create(
            model="o3-mini",
            messages=[
                {"role": "system", "content": (
                    "You are my personal AI financial news analyst. "
                    "You will look for new partnerships or anything you believe will impact the price of that stock. Return response as general insight per stock, not per article."
                )},
                {"role": "user", "content": content}
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "news_article_analysis",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "summary": {"type": "string"},
                            "sentiment": {
                                "type": "string",
                                "enum": ["positive", "neutral", "negative"]
                            },
                            "relevance": {
                                "type": "string",
                                "description": "How relevant this article is to stock movement",
                                "enum": ["high", "medium", "low"]
                            },
                            "impact_score": {
                                "type": "number",
                                "description": "Estimated market impact (0 to 1 scale)"
                            },
                            "recommendation": {
                                "type": "string",
                                "enum": ["buy", "hold", "sell"]
                            }
                        },
                        "required": ["summary", "sentiment", "relevance", "impact_score", "recommendation"]
                    }
                }
            }
        )

        choice = response.choices[0].message

        # With JSON schema, the SDK may provide a parsed object; otherwise parse the string.
        if hasattr(choice, "parsed") and choice.parsed is not None:
            parsed = choice.parsed
        else:
            raw = choice.content
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = raw  # fallback to raw string if parsing fails

        self.evaluated_news[ticker] = parsed

        # message is a ChatCompletionMessage; use .content instead of subscription

    def print_evaluated_news(self):
        for ticker, evaluation in self.evaluated_news.items():
            print(f"\nTicker: {ticker} - Evaluation:")
            if isinstance(evaluation, str):
                print(evaluation)
            else:
                print(json.dumps(evaluation, indent=2))
