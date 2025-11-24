import evaluator_module.metric_evaluator as me


if __name__ == "__main__": 
    print("Evaluating all metrics...")
    MetricEvaluatorInstance = me.MetricEvaluator()
    evaluated_metrics = MetricEvaluatorInstance.get_evaluated_metrics()
    MetricEvaluatorInstance.print_evaluated_metrics()
