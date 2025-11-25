from typing import List, Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.params import Header
from fastapi.responses import JSONResponse
from endpoint_pipeline.metrics_pipeline import MetricPipeline
import os
from dotenv import load_dotenv


load_dotenv()  # load .env file

API_KEY = os.getenv("API_KEY")

app = FastAPI()
pipeline = MetricPipeline()

print(API_KEY)

@app.get("/run")
def run_pipeline(api_key: str = Header(None), tickers: Optional[str] = Query(None, description="Tickers to evaluate")):
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid API Key")
    
    # Ensure we always work with a list of strings and have a sensible fallback
    tickers_list = str(tickers).strip().split(',') if tickers else []
    results = pipeline.run(tickers_list)
    return JSONResponse(content=results)
