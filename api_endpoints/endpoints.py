from typing import List, Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.params import Header
from fastapi.responses import JSONResponse
from endpoint_pipeline.metrics_pipeline import MetricPipeline
from endpoint_pipeline.news_pipeline import NewsPipeline
import os
from dotenv import load_dotenv


load_dotenv()  # load .env file

API_KEY = os.getenv("API_KEY")

app = FastAPI()
pipeline = None

newsPipeline = None

def get_pipeline():
    global pipeline
    if pipeline is None:
        pipeline = MetricPipeline()
    return pipeline

def get_news_pipeline():
    global newsPipeline
    if newsPipeline is None:
        newsPipeline = NewsPipeline()
    return newsPipeline

@app.get("/run")
def run_pipeline(api_key: str = Header(None), tickers: Optional[str] = Query(None, description="Tickers to evaluate")):
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid API Key")
    
    # Ensure we always work with a list of strings and have a sensible fallback
    tickers_list = str(tickers).strip().split(',') if tickers else []
    p = get_pipeline()   # lazy load here
    results = p.run(tickers_list)

    return JSONResponse(content=results)

@app.get("/runNews")
def run_pipeline(api_key: str = Header(None), tickers: Optional[str] = Query(None, description="Tickers to evaluate")):
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid API Key")
    
    # Ensure we always work with a list of strings and have a sensible fallback
    tickers_list = str(tickers).strip().split(',') if tickers else []
    n = get_news_pipeline()   # lazy load here
    results = n.run(tickers_list)

    return JSONResponse(content=results)

