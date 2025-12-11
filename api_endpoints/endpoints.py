from typing import Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.params import Header
from fastapi.responses import JSONResponse
from endpoint_pipeline.metrics_pipeline import MetricPipeline
from endpoint_pipeline.model_pipeline import ModelPipeline
from endpoint_pipeline.news_pipeline import NewsPipeline
import os
from dotenv import load_dotenv

from endpoint_pipeline.portfolio_pipeline import PortfolioPipeline


load_dotenv()

API_KEY = os.getenv("API_KEY")

app = FastAPI()

pipeline = None

newsPipeline = None

modelPipeline = None

portfolioPipeline = None

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

def get_model_pipeline():
    global modelPipeline
    if modelPipeline is None:
        modelPipeline = ModelPipeline()
    return modelPipeline

def get_portfolio_pipeline():
    global portfolioPipeline
    if portfolioPipeline is None:
        portfolioPipeline = PortfolioPipeline()
    return portfolioPipeline

@app.get("/run")
def run_pipeline(api_key: str = Header(None), tickers: Optional[str] = Query(None, description="Tickers to evaluate")):
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid API Key")
    
    # Ensure we always work with a list of strings and have a sensible fallback
    p = get_pipeline()   # lazy load here
    results = p.run()

    return JSONResponse(content=results)

@app.get("/runNews")
def run_pipeline(api_key: str = Header(None), tickers: Optional[str] = Query(None, description="Tickers to evaluate")):
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid API Key")
    
    n = get_news_pipeline()   # lazy load here
    results = n.run()

    return JSONResponse(content=results)

@app.get("/runModel")
def run_pipeline(api_key: str = Header(None), tickers: Optional[str] = Query(None, description="Tickers to evaluate")):
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid API Key")
    
    # Ensure we always work with a list of strings and have a sensible fallback
    # tickers_list = str(tickers).strip().split(',') if tickers else []
    n = get_model_pipeline()   # lazy load here
    results = n.run()

    return JSONResponse(content=results)


@app.get("/portfolio")
def get_portfolio():
    p = get_portfolio_pipeline()
    return p.load_portfolio()

@app.post("/update_portfolio")
def update_portfolio(update: dict, api_key: str = Header(None)):
    if api_key != API_KEY:
        raise HTTPException(401, "Invalid API key")
    
    p = get_portfolio_pipeline()

    portfolio = p.load_portfolio()

    # Merge updates (smart merge)
    if "holdings" in update:
        portfolio["holdings"] = {
            **portfolio.get("holdings", {}),
            **update["holdings"]
        }

    # Merge top-level fields
    for k, v in update.items():
        if k != "holdings":
            portfolio[k] = v

    p.save_portfolio(portfolio)
    return {"status": "updated", "portfolio": portfolio}

