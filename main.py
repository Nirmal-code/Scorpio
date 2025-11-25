import data_loader.news_fetcher as nf
import evaluator_module.metric_evaluator as me
import evaluator_module.news_evaluator as ne

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
    NewsEvaluatorInstance = ne.NewsEvaluator()
    NewsEvaluatorInstance.evaluate_news_relevance(stocks)


