

from evaluator_module.metric_evaluator import MetricEvaluator


class MetricPipeline:
    def __init__(self):
        self.evaluator = MetricEvaluator()

    def run(self, tickers):
        evaluated_metrics = self.evaluator.get_evaluated_metrics(tickers)
        return evaluated_metrics