import json
import data_loader.news_fetcher as nf
import evaluator_module.metric_evaluator as me
import evaluator_module.ai_evaluator as ae
from pathlib import Path

if __name__ == "__main__": 
    # print("Evaluating all metrics...")
    # MetricEvaluatorInstance = me.MetricEvaluator()
    # evaluated_metrics = MetricEvaluatorInstance.get_evaluated_metrics()
    # MetricEvaluatorInstance.print_evaluated_metrics()

    print("Fetching all news articles...")

    # Can call this once every 6 minutes. But just make it once every half an hour.
    stocks = ["GOOGL","META","NVDA","INTC","SHOP","AMD","AAPL","NET","CAE"] 
    # NewsFetcherInstance = nf.NewsFetcher()
    # latest_relevant_news = NewsFetcherInstance.get_relevant_news_articles(limit=200, tickers = stocks)
    metrics = me.MetricEvaluator().get_evaluated_metrics(stocks)
    news = nf.NewsFetcher().get_relevant_news_articles(stocks, limit=10)
    profile_path = Path(__file__).parent / "investment_data" / "profile.json"
    with profile_path.open() as f:
        profile = json.load(f)

    AIEvaluatorInstance = ae.AIEvaluator()
    ai_evaluated_news = AIEvaluatorInstance.model_evaluation(profile=profile, metrics=metrics, news=news)
    print(ai_evaluated_news)


