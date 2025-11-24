from typing import List, Optional
from fastapi import FastAPI, Query
from fastapi.encoders import jsonable_encoder
from endpoint_pipeline.metrics_pipeline import MetricPipeline


app = FastAPI()
pipeline = MetricPipeline()


@app.get("/run")
def run_pipeline(tickers: Optional[str] = Query(None, description="Tickers to evaluate")):
    # Ensure we always work with a list of strings and have a sensible fallback
    tickers_list = str(tickers).strip().split(',') if tickers else []
    print(tickers_list)
    results = pipeline.run(tickers_list)
    return jsonable_encoder({"status": "success", "data": results})